using System;
using System.Buffers;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Sockets;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Ai;
using Mnemo.Core.Services;
using Mnemo.Core.Services.Ai;

namespace Mnemo.Infrastructure.Services.AI;

/// <summary>
/// Streaming chat client for OpenRouter's OpenAI-compatible completions API. Speaks SSE,
/// assembles native tool calls from provider fragments, and maps transport/HTTP failures onto
/// <see cref="AiClientException"/> categories the UI can present.
/// </summary>
/// <remarks>
/// The API key is read fresh from settings on every call so a key edited at runtime applies to
/// the next turn without a restart. Neither the key nor message content is ever logged.
/// </remarks>
public sealed class OpenRouterChatClient : IChatModelClient
{
    // Shared with the router (same key gates routing) and with DI registration (named client).
    internal const string ApiKeySettingKey = "AI.OpenRouter.ApiKey";
    public const string HttpClientName = "OpenRouter";
    private const string Endpoint = "https://openrouter.ai/api/v1/chat/completions";
    private const string LogCategory = "OpenRouterChatClient";
    private const int MaxAttempts = 3;

    // The stream itself can run for minutes; this bounds only the wait for response headers.
    private static readonly TimeSpan FirstHeadersTimeout = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan MaxRetryDelay = TimeSpan.FromSeconds(30);

    // Relaxed escaping keeps caller-supplied JSON Schemas and tool arguments byte-identical on the
    // wire; this is a JSON API with no HTML context, so unescaped '<', '>', '&' are safe.
    private static readonly JsonWriterOptions WriterOptions = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    private static readonly JsonSerializerOptions ReadOptions = new()
    {
        NumberHandling = JsonNumberHandling.AllowReadingFromString,
    };

    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ISettingsService _settings;
    private readonly ILoggerService _logger;
    private readonly Func<TimeSpan, CancellationToken, Task> _retryDelay;

    public OpenRouterChatClient(IHttpClientFactory httpClientFactory, ISettingsService settings, ILoggerService logger)
        : this(httpClientFactory, settings, logger, static (delay, ct) => Task.Delay(delay, ct))
    {
    }

    // Test seam: the retry delay is injected so tests exercise the backoff schedule without sleeping.
    internal OpenRouterChatClient(
        IHttpClientFactory httpClientFactory,
        ISettingsService settings,
        ILoggerService logger,
        Func<TimeSpan, CancellationToken, Task> retryDelay)
    {
        _httpClientFactory = httpClientFactory;
        _settings = settings;
        _logger = logger;
        _retryDelay = retryDelay;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<ChatStreamDelta> StreamAsync(
        ChatRequest request,
        [EnumeratorCancellation] CancellationToken ct = default)
    {
        var apiKey = await _settings.GetAsync(ApiKeySettingKey, string.Empty).ConfigureAwait(false);
        if (string.IsNullOrWhiteSpace(apiKey))
        {
            throw new AiClientException(AiClientErrorKind.InvalidApiKey, "OpenRouter API key is not configured.");
        }

        var client = _httpClientFactory.CreateClient(HttpClientName);
        var body = SerializeRequest(request);

        // Retries are confined to the send + status check; once the body is being read, no re-send happens.
        var response = await SendWithRetryAsync(client, apiKey, request.ModelId, body, ct).ConfigureAwait(false);

        var state = new StreamState();
        Stream? stream = null;
        StreamReader? reader = null;
        try
        {
            stream = await response.Content.ReadAsStreamAsync(ct).ConfigureAwait(false);
            reader = new StreamReader(stream, Encoding.UTF8);

            while (true)
            {
                string? line;
                try
                {
                    line = await reader.ReadLineAsync(ct).ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                    throw;
                }
                catch (Exception ex) when (ex is IOException or HttpRequestException)
                {
                    throw new AiClientException(
                        AiClientErrorKind.Network,
                        "Network error while reading the OpenRouter response stream.",
                        innerException: ex);
                }

                if (line is null)
                {
                    break;
                }

                // ParseLine is a plain method (no hidden yields), so it may throw the mapped
                // exception for an inline error chunk without violating the yield-in-try rule.
                foreach (var delta in ParseLine(line, state))
                {
                    yield return delta;
                }

                if (state.Done)
                {
                    break;
                }
            }

            foreach (var toolCall in state.DrainToolCalls())
            {
                yield return toolCall;
            }

            yield return new ChatStreamDelta.Finish(state.ResolveFinishReason());
        }
        finally
        {
            reader?.Dispose();
            stream?.Dispose();
            response.Dispose();
        }
    }

    private List<ChatStreamDelta> ParseLine(string line, StreamState state)
    {
        var results = new List<ChatStreamDelta>();

        // SSE framing: blank lines separate events, ':' lines are comments/keep-alives.
        if (line.Length == 0 || line[0] == ':')
        {
            return results;
        }

        if (!line.StartsWith("data:", StringComparison.Ordinal))
        {
            return results;
        }

        var payload = line.AsSpan("data:".Length).Trim().ToString();
        if (payload.Length == 0)
        {
            return results;
        }

        if (payload == "[DONE]")
        {
            state.Done = true;
            return results;
        }

        StreamChunk? chunk;
        try
        {
            chunk = JsonSerializer.Deserialize<StreamChunk>(payload, ReadOptions);
        }
        catch (JsonException ex)
        {
            // One malformed chunk must not tear down the stream.
            _logger.Warning(LogCategory, $"Skipping malformed OpenRouter stream chunk: {ex.Message}");
            return results;
        }

        if (chunk is null)
        {
            return results;
        }

        if (chunk.Error is { } error)
        {
            throw MapStreamError(error);
        }

        var choice = chunk.Choices is { Count: > 0 } ? chunk.Choices[0] : null;
        if (choice?.Delta is { } delta)
        {
            if (!string.IsNullOrEmpty(delta.Content))
            {
                results.Add(new ChatStreamDelta.Content(delta.Content));
            }

            var reasoning = !string.IsNullOrEmpty(delta.Reasoning) ? delta.Reasoning : delta.ReasoningContent;
            if (!string.IsNullOrEmpty(reasoning))
            {
                results.Add(new ChatStreamDelta.Reasoning(reasoning));
            }

            if (delta.ToolCalls is { } fragments)
            {
                foreach (var fragment in fragments)
                {
                    state.AccumulateToolCall(fragment);
                }
            }
        }

        if (choice?.FinishReason is { } finishReason)
        {
            state.FinishReason = MapFinishReason(finishReason);
        }

        if (chunk.Usage is { } usage)
        {
            results.Add(new ChatStreamDelta.Usage(MapUsage(usage)));
        }

        return results;
    }

    private async Task<HttpResponseMessage> SendWithRetryAsync(
        HttpClient client,
        string apiKey,
        string modelId,
        string body,
        CancellationToken ct)
    {
        for (var attempt = 1; ; attempt++)
        {
            HttpResponseMessage response;
            try
            {
                // HttpRequestMessage is single-use, so each attempt rebuilds it.
                using var httpRequest = BuildHttpRequest(apiKey, body);
                response = await SendOnceAsync(client, httpRequest, ct).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception ex) when (ex is HttpRequestException or IOException or SocketException)
            {
                var networkFailure = new AiClientException(
                    AiClientErrorKind.Network, "Network error contacting OpenRouter.", innerException: ex);
                if (attempt < MaxAttempts)
                {
                    await LogAndDelayAsync(attempt, ComputeBackoff(attempt), networkFailure, modelId, ct).ConfigureAwait(false);
                    continue;
                }
                throw networkFailure;
            }

            if (response.IsSuccessStatusCode)
            {
                return response;
            }

            var status = (int)response.StatusCode;
            var reason = response.ReasonPhrase;
            var providerMessage = await TryReadErrorMessageAsync(response, ct).ConfigureAwait(false);
            var retryAfter = ParseRetryAfter(response.Headers);
            response.Dispose();

            var failure = new AiClientException(
                OpenRouterErrors.MapStatusToKind(status), BuildHttpErrorMessage(status, reason, providerMessage), httpStatus: status);

            if (IsRetryableStatus(status) && attempt < MaxAttempts)
            {
                await LogAndDelayAsync(attempt, retryAfter ?? ComputeBackoff(attempt), failure, modelId, ct).ConfigureAwait(false);
                continue;
            }

            throw failure;
        }
    }

    private async Task<HttpResponseMessage> SendOnceAsync(HttpClient client, HttpRequestMessage httpRequest, CancellationToken ct)
    {
        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeoutCts.CancelAfter(FirstHeadersTimeout);
        try
        {
            return await client
                .SendAsync(httpRequest, HttpCompletionOption.ResponseHeadersRead, timeoutCts.Token)
                .ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            // The caller's token is untouched, so this cancellation is our own first-headers timeout.
            throw new AiClientException(
                AiClientErrorKind.Timeout,
                $"OpenRouter did not return response headers within {FirstHeadersTimeout.TotalSeconds:F0}s.");
        }
    }

    private static HttpRequestMessage BuildHttpRequest(string apiKey, string body)
    {
        var httpRequest = new HttpRequestMessage(HttpMethod.Post, Endpoint)
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json"),
        };
        httpRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
        httpRequest.Headers.TryAddWithoutValidation("X-Title", "Mnemo");
        return httpRequest;
    }

    private async Task LogAndDelayAsync(int attempt, TimeSpan delay, AiClientException failure, string modelId, CancellationToken ct)
    {
        var capped = delay > MaxRetryDelay ? MaxRetryDelay : delay;
        var statusText = failure.HttpStatus is { } s ? $"HTTP {s}" : failure.Kind.ToString();
        _logger.Warning(
            LogCategory,
            $"OpenRouter request failed (attempt {attempt}/{MaxAttempts}, {statusText}) for model {modelId}; retrying in {capped.TotalMilliseconds:F0}ms.");
        await _retryDelay(capped, ct).ConfigureAwait(false);
    }

    private static TimeSpan ComputeBackoff(int attempt)
    {
        // 1s, 2s, 4s, … by attempt, plus jitter to spread out concurrent retries.
        var baseSeconds = Math.Pow(2, attempt - 1);
        var jitter = TimeSpan.FromMilliseconds(Random.Shared.Next(0, 251));
        return TimeSpan.FromSeconds(baseSeconds) + jitter;
    }

    private static bool IsRetryableStatus(int status) => status is 429 or 500 or 502 or 503;

    private static ChatFinishReason MapFinishReason(string reason) => reason switch
    {
        "stop" => ChatFinishReason.Stop,
        "tool_calls" => ChatFinishReason.ToolCalls,
        "length" => ChatFinishReason.Length,
        "content_filter" => ChatFinishReason.ContentFilter,
        _ => ChatFinishReason.Other,
    };

    private static TokenUsage MapUsage(UsageWire usage) => new(
        usage.PromptTokens ?? 0,
        usage.CompletionTokens ?? 0,
        usage.CompletionTokensDetails?.ReasoningTokens,
        usage.Cost);

    private static AiClientException MapStreamError(ErrorWire error)
    {
        var status = ExtractErrorStatus(error);
        var kind = status is { } s ? OpenRouterErrors.MapStatusToKind(s) : AiClientErrorKind.Unknown;
        var message = string.IsNullOrWhiteSpace(error.Message)
            ? "OpenRouter reported an error mid-stream."
            : error.Message!;
        return new AiClientException(kind, message, httpStatus: status);
    }

    private static int? ExtractErrorStatus(ErrorWire error)
    {
        if (error.Code is { } code)
        {
            if (code.ValueKind == JsonValueKind.Number && code.TryGetInt32(out var n))
            {
                return n;
            }
            if (code.ValueKind == JsonValueKind.String && int.TryParse(code.GetString(), out var parsed))
            {
                return parsed;
            }
        }
        return null;
    }

    private static string BuildHttpErrorMessage(int status, string? reason, string? providerMessage)
    {
        var detail = !string.IsNullOrWhiteSpace(providerMessage) ? providerMessage
            : !string.IsNullOrWhiteSpace(reason) ? reason
            : "no additional detail";
        return $"OpenRouter returned HTTP {status}: {detail}";
    }

    private static async Task<string?> TryReadErrorMessageAsync(HttpResponseMessage response, CancellationToken ct)
    {
        string bodyText;
        try
        {
            bodyText = await response.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch
        {
            return null;
        }

        if (string.IsNullOrWhiteSpace(bodyText))
        {
            return null;
        }

        try
        {
            using var doc = JsonDocument.Parse(bodyText);
            if (doc.RootElement.ValueKind == JsonValueKind.Object
                && doc.RootElement.TryGetProperty("error", out var error)
                && error.ValueKind == JsonValueKind.Object
                && error.TryGetProperty("message", out var message)
                && message.ValueKind == JsonValueKind.String)
            {
                return message.GetString();
            }
        }
        catch (JsonException)
        {
            // A non-JSON error body carries no structured message; the reason phrase stands in.
        }

        return null;
    }

    private static TimeSpan? ParseRetryAfter(HttpResponseHeaders headers)
    {
        var retryAfter = headers.RetryAfter;
        if (retryAfter is null)
        {
            return null;
        }
        if (retryAfter.Delta is { } delta)
        {
            return delta < TimeSpan.Zero ? TimeSpan.Zero : delta;
        }
        if (retryAfter.Date is { } date)
        {
            var wait = date - DateTimeOffset.UtcNow;
            return wait < TimeSpan.Zero ? TimeSpan.Zero : wait;
        }
        return null;
    }

    private static string SerializeRequest(ChatRequest request)
    {
        var buffer = new ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(buffer, WriterOptions))
        {
            writer.WriteStartObject();
            writer.WriteString("model", request.ModelId);

            writer.WritePropertyName("messages");
            writer.WriteStartArray();
            foreach (var message in request.Messages)
            {
                WriteMessage(writer, message);
            }
            writer.WriteEndArray();

            writer.WriteBoolean("stream", true);

            writer.WritePropertyName("usage");
            writer.WriteStartObject();
            writer.WriteBoolean("include", true);
            writer.WriteEndObject();

            if (request.Tools is { Count: > 0 } tools)
            {
                writer.WritePropertyName("tools");
                writer.WriteStartArray();
                foreach (var tool in tools)
                {
                    writer.WriteStartObject();
                    writer.WriteString("type", "function");
                    writer.WritePropertyName("function");
                    writer.WriteStartObject();
                    writer.WriteString("name", tool.Name);
                    writer.WriteString("description", tool.Description);
                    writer.WritePropertyName("parameters");
                    tool.ParametersSchema.WriteTo(writer);
                    writer.WriteEndObject();
                    writer.WriteEndObject();
                }
                writer.WriteEndArray();
            }

            if (request.ResponseSchema is { } schema)
            {
                writer.WritePropertyName("response_format");
                writer.WriteStartObject();
                writer.WriteString("type", "json_schema");
                writer.WritePropertyName("json_schema");
                writer.WriteStartObject();
                writer.WriteString("name", schema.Name);
                writer.WriteBoolean("strict", schema.Strict);
                writer.WritePropertyName("schema");
                schema.Schema.WriteTo(writer);
                writer.WriteEndObject();
                writer.WriteEndObject();
            }

            if (request.Temperature is { } temperature)
            {
                writer.WriteNumber("temperature", temperature);
            }

            if (request.MaxOutputTokens is { } maxTokens)
            {
                writer.WriteNumber("max_tokens", maxTokens);
            }

            if (request.ReasoningEffort is { } effort)
            {
                writer.WritePropertyName("reasoning");
                writer.WriteStartObject();
                writer.WriteString("effort", EffortToWire(effort));
                writer.WriteEndObject();
            }

            writer.WriteEndObject();
        }

        return Encoding.UTF8.GetString(buffer.WrittenSpan);
    }

    private static void WriteMessage(Utf8JsonWriter writer, ChatMessage message)
    {
        writer.WriteStartObject();
        switch (message.Role)
        {
            case ChatMessageRole.System:
                writer.WriteString("role", "system");
                writer.WriteString("content", message.Content);
                break;

            case ChatMessageRole.User:
                writer.WriteString("role", "user");
                writer.WriteString("content", message.Content);
                break;

            case ChatMessageRole.Assistant:
                writer.WriteString("role", "assistant");
                if (message.ToolCalls is { Count: > 0 } toolCalls)
                {
                    writer.WritePropertyName("content");
                    if (message.Content is null)
                    {
                        writer.WriteNullValue();
                    }
                    else
                    {
                        writer.WriteStringValue(message.Content);
                    }

                    writer.WritePropertyName("tool_calls");
                    writer.WriteStartArray();
                    foreach (var call in toolCalls)
                    {
                        writer.WriteStartObject();
                        writer.WriteString("id", call.Id);
                        writer.WriteString("type", "function");
                        writer.WritePropertyName("function");
                        writer.WriteStartObject();
                        writer.WriteString("name", call.Name);
                        // arguments is a JSON-encoded string, not a nested object.
                        writer.WriteString("arguments", call.ArgumentsJson);
                        writer.WriteEndObject();
                        writer.WriteEndObject();
                    }
                    writer.WriteEndArray();
                }
                else
                {
                    writer.WriteString("content", message.Content);
                }
                break;

            case ChatMessageRole.Tool:
                writer.WriteString("role", "tool");
                writer.WriteString("tool_call_id", message.ToolCallId);
                writer.WriteString("content", message.Content);
                if (!string.IsNullOrEmpty(message.ToolName))
                {
                    writer.WriteString("name", message.ToolName);
                }
                break;
        }
        writer.WriteEndObject();
    }

    private static string EffortToWire(ChatReasoningEffort effort) => effort switch
    {
        ChatReasoningEffort.Low => "low",
        ChatReasoningEffort.Medium => "medium",
        ChatReasoningEffort.High => "high",
        _ => "medium",
    };

    /// <summary>Per-stream accumulator for tool-call fragments and the finish reason.</summary>
    private sealed class StreamState
    {
        private readonly Dictionary<int, ToolCallAccumulator> _toolCalls = new();

        public bool Done { get; set; }

        public ChatFinishReason? FinishReason { get; set; }

        public void AccumulateToolCall(ToolCallFragmentWire fragment)
        {
            if (!_toolCalls.TryGetValue(fragment.Index, out var accumulator))
            {
                accumulator = new ToolCallAccumulator();
                _toolCalls[fragment.Index] = accumulator;
            }

            // Id and name arrive on the first fragment; arguments arrive as string pieces.
            if (!string.IsNullOrEmpty(fragment.Id))
            {
                accumulator.Id = fragment.Id;
            }
            if (fragment.Function is { } function)
            {
                if (!string.IsNullOrEmpty(function.Name))
                {
                    accumulator.Name = function.Name;
                }
                if (!string.IsNullOrEmpty(function.Arguments))
                {
                    accumulator.Arguments.Append(function.Arguments);
                }
            }
        }

        public IEnumerable<ChatStreamDelta> DrainToolCalls()
        {
            foreach (var index in _toolCalls.Keys.OrderBy(static i => i))
            {
                var accumulator = _toolCalls[index];
                yield return new ChatStreamDelta.ToolCall(new ToolCallRequest(
                    accumulator.Id ?? string.Empty,
                    accumulator.Name ?? string.Empty,
                    accumulator.Arguments.ToString()));
            }
        }

        public ChatFinishReason ResolveFinishReason()
            => FinishReason ?? (_toolCalls.Count > 0 ? ChatFinishReason.ToolCalls : ChatFinishReason.Stop);
    }

    private sealed class ToolCallAccumulator
    {
        public string? Id { get; set; }
        public string? Name { get; set; }
        public StringBuilder Arguments { get; } = new();
    }

    private sealed class StreamChunk
    {
        [JsonPropertyName("choices")] public List<StreamChoice>? Choices { get; set; }
        [JsonPropertyName("usage")] public UsageWire? Usage { get; set; }
        [JsonPropertyName("error")] public ErrorWire? Error { get; set; }
    }

    private sealed class StreamChoice
    {
        [JsonPropertyName("delta")] public DeltaWire? Delta { get; set; }
        [JsonPropertyName("finish_reason")] public string? FinishReason { get; set; }
    }

    private sealed class DeltaWire
    {
        [JsonPropertyName("content")] public string? Content { get; set; }
        [JsonPropertyName("reasoning")] public string? Reasoning { get; set; }
        [JsonPropertyName("reasoning_content")] public string? ReasoningContent { get; set; }
        [JsonPropertyName("tool_calls")] public List<ToolCallFragmentWire>? ToolCalls { get; set; }
    }

    private sealed class ToolCallFragmentWire
    {
        [JsonPropertyName("index")] public int Index { get; set; }
        [JsonPropertyName("id")] public string? Id { get; set; }
        [JsonPropertyName("function")] public ToolFunctionWire? Function { get; set; }
    }

    private sealed class ToolFunctionWire
    {
        [JsonPropertyName("name")] public string? Name { get; set; }
        [JsonPropertyName("arguments")] public string? Arguments { get; set; }
    }

    private sealed class UsageWire
    {
        [JsonPropertyName("prompt_tokens")] public int? PromptTokens { get; set; }
        [JsonPropertyName("completion_tokens")] public int? CompletionTokens { get; set; }
        [JsonPropertyName("completion_tokens_details")] public CompletionTokensDetailsWire? CompletionTokensDetails { get; set; }
        [JsonPropertyName("cost")] public decimal? Cost { get; set; }
    }

    private sealed class CompletionTokensDetailsWire
    {
        [JsonPropertyName("reasoning_tokens")] public int? ReasoningTokens { get; set; }
    }

    private sealed class ErrorWire
    {
        [JsonPropertyName("code")] public JsonElement? Code { get; set; }
        [JsonPropertyName("message")] public string? Message { get; set; }
    }
}
