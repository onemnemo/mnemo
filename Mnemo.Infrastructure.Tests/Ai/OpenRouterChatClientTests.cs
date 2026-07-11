using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Enums;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Ai;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.AI;

namespace Mnemo.Infrastructure.Tests.Ai;

public class OpenRouterChatClientTests
{
    private const string ApiKeyKey = "AI.OpenRouter.ApiKey";

    private static (OpenRouterChatClient Client, List<TimeSpan> Delays) NewClient(
        FakeHttpMessageHandler handler,
        ISettingsService? settings = null,
        ILoggerService? logger = null)
    {
        var delays = new List<TimeSpan>();
        var client = new OpenRouterChatClient(
            new FakeHttpClientFactory(handler),
            settings ?? new FakeSettingsService().Set(ApiKeyKey, "test-key"),
            logger ?? new TestLogger(),
            (delay, _) =>
            {
                delays.Add(delay);
                return Task.CompletedTask;
            });
        return (client, delays);
    }

    private static ChatRequest SimpleRequest() => new()
    {
        ModelId = "test-model",
        Messages = new[] { ChatMessage.User("hi") },
    };

    private static string EventStream(params string[] lines) => string.Join("\n", lines) + "\n";

    private static string SimpleStream() => EventStream(
        """data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}""",
        "data: [DONE]");

    private static async Task<List<ChatStreamDelta>> CollectAsync(IAsyncEnumerable<ChatStreamDelta> stream)
    {
        var deltas = new List<ChatStreamDelta>();
        await foreach (var delta in stream)
        {
            deltas.Add(delta);
        }
        return deltas;
    }

    private static JsonElement ParseBody(RecordedRequest request)
    {
        using var doc = JsonDocument.Parse(request.Content!);
        return doc.RootElement.Clone();
    }

    private static JsonElement ParseElement(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }

    // 1. Missing/blank key → InvalidApiKey before any HTTP.
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Blank_or_missing_api_key_throws_without_sending(string? key)
    {
        var handler = new FakeHttpMessageHandler();
        var settings = new FakeSettingsService();
        if (key is not null)
        {
            settings.Set(ApiKeyKey, key);
        }
        var (client, _) = NewClient(handler, settings);

        var ex = await Assert.ThrowsAsync<AiClientException>(async () => await CollectAsync(client.StreamAsync(SimpleRequest())));

        Assert.Equal(AiClientErrorKind.InvalidApiKey, ex.Kind);
        Assert.Empty(handler.Requests);
    }

    // 2. Request envelope + headers.
    [Fact]
    public async Task Serializes_full_request_envelope_and_headers()
    {
        var handler = new FakeHttpMessageHandler().EnqueueResponse(HttpStatusCode.OK, SimpleStream());
        var (client, _) = NewClient(handler);
        var request = new ChatRequest
        {
            ModelId = "openai/gpt-4o",
            Messages = new[] { ChatMessage.System("sys"), ChatMessage.User("hi") },
            Temperature = 0.7,
            MaxOutputTokens = 512,
            ReasoningEffort = ChatReasoningEffort.High,
        };

        await CollectAsync(client.StreamAsync(request));

        var recorded = Assert.Single(handler.Requests);
        Assert.Equal(HttpMethod.Post, recorded.Method);
        Assert.Equal("https://openrouter.ai/api/v1/chat/completions", recorded.Uri!.ToString());
        Assert.Equal("Bearer test-key", recorded.Header("Authorization"));
        Assert.Equal("Mnemo", recorded.Header("X-Title"));

        var body = ParseBody(recorded);
        Assert.Equal("openai/gpt-4o", body.GetProperty("model").GetString());
        Assert.True(body.GetProperty("stream").GetBoolean());
        Assert.True(body.GetProperty("usage").GetProperty("include").GetBoolean());
        Assert.Equal(0.7, body.GetProperty("temperature").GetDouble());
        Assert.Equal(512, body.GetProperty("max_tokens").GetInt32());
        Assert.Equal("high", body.GetProperty("reasoning").GetProperty("effort").GetString());
    }

    [Theory]
    [InlineData(ChatReasoningEffort.Low, "low")]
    [InlineData(ChatReasoningEffort.Medium, "medium")]
    [InlineData(ChatReasoningEffort.High, "high")]
    public async Task Serializes_reasoning_effort(ChatReasoningEffort effort, string expected)
    {
        var handler = new FakeHttpMessageHandler().EnqueueResponse(HttpStatusCode.OK, SimpleStream());
        var (client, _) = NewClient(handler);
        var request = new ChatRequest
        {
            ModelId = "m",
            Messages = new[] { ChatMessage.User("hi") },
            ReasoningEffort = effort,
        };

        await CollectAsync(client.StreamAsync(request));

        var body = ParseBody(Assert.Single(handler.Requests));
        Assert.Equal(expected, body.GetProperty("reasoning").GetProperty("effort").GetString());
    }

    // 3. Message shapes.
    [Fact]
    public async Task Serializes_message_shapes()
    {
        var handler = new FakeHttpMessageHandler().EnqueueResponse(HttpStatusCode.OK, SimpleStream());
        var (client, _) = NewClient(handler);
        var toolCall = new ToolCallRequest("call_1", "get_weather", """{"city":"NYC"}""");
        var request = new ChatRequest
        {
            ModelId = "m",
            Messages = new[]
            {
                ChatMessage.System("you are helpful"),
                ChatMessage.User("weather?"),
                ChatMessage.AssistantToolCalls(new[] { toolCall }, "let me check"),
                ChatMessage.ToolResult(new ToolCallResult("call_1", "get_weather", "sunny")),
            },
        };

        await CollectAsync(client.StreamAsync(request));

        var messages = ParseBody(Assert.Single(handler.Requests)).GetProperty("messages");
        Assert.Equal(4, messages.GetArrayLength());

        Assert.Equal("system", messages[0].GetProperty("role").GetString());
        Assert.Equal("you are helpful", messages[0].GetProperty("content").GetString());

        Assert.Equal("user", messages[1].GetProperty("role").GetString());
        Assert.Equal("weather?", messages[1].GetProperty("content").GetString());

        var assistant = messages[2];
        Assert.Equal("assistant", assistant.GetProperty("role").GetString());
        Assert.Equal("let me check", assistant.GetProperty("content").GetString());
        var wireCall = assistant.GetProperty("tool_calls")[0];
        Assert.Equal("call_1", wireCall.GetProperty("id").GetString());
        Assert.Equal("function", wireCall.GetProperty("type").GetString());
        Assert.Equal("get_weather", wireCall.GetProperty("function").GetProperty("name").GetString());
        var arguments = wireCall.GetProperty("function").GetProperty("arguments");
        Assert.Equal(JsonValueKind.String, arguments.ValueKind);
        Assert.Equal("""{"city":"NYC"}""", arguments.GetString());

        var tool = messages[3];
        Assert.Equal("tool", tool.GetProperty("role").GetString());
        Assert.Equal("call_1", tool.GetProperty("tool_call_id").GetString());
        Assert.Equal("sunny", tool.GetProperty("content").GetString());
        Assert.Equal("get_weather", tool.GetProperty("name").GetString());
    }

    // 4. Tools + response_format verbatim.
    [Fact]
    public async Task Serializes_tools_and_response_format_verbatim()
    {
        var handler = new FakeHttpMessageHandler().EnqueueResponse(HttpStatusCode.OK, SimpleStream());
        var (client, _) = NewClient(handler);

        const string parametersJson = """{"type":"object","properties":{"city":{"type":"string"}},"required":["city"]}""";
        const string schemaJson = """{"type":"object","properties":{"answer":{"type":"string"}},"additionalProperties":false}""";
        var request = new ChatRequest
        {
            ModelId = "m",
            Messages = new[] { ChatMessage.User("hi") },
            Tools = new[] { new ChatToolDefinition("get_weather", "Look up weather", ParseElement(parametersJson)) },
            ResponseSchema = new ChatResponseSchema("weather_answer", ParseElement(schemaJson), Strict: true),
        };

        await CollectAsync(client.StreamAsync(request));

        var body = ParseBody(Assert.Single(handler.Requests));

        var wireTool = body.GetProperty("tools")[0];
        Assert.Equal("function", wireTool.GetProperty("type").GetString());
        var function = wireTool.GetProperty("function");
        Assert.Equal("get_weather", function.GetProperty("name").GetString());
        Assert.Equal("Look up weather", function.GetProperty("description").GetString());
        Assert.Equal(parametersJson, function.GetProperty("parameters").GetRawText());

        var responseFormat = body.GetProperty("response_format");
        Assert.Equal("json_schema", responseFormat.GetProperty("type").GetString());
        var jsonSchema = responseFormat.GetProperty("json_schema");
        Assert.Equal("weather_answer", jsonSchema.GetProperty("name").GetString());
        Assert.True(jsonSchema.GetProperty("strict").GetBoolean());
        Assert.Equal(schemaJson, jsonSchema.GetProperty("schema").GetRawText());
    }

    // 5. Unset options omitted entirely.
    [Fact]
    public async Task Omits_unset_options()
    {
        var handler = new FakeHttpMessageHandler().EnqueueResponse(HttpStatusCode.OK, SimpleStream());
        var (client, _) = NewClient(handler);

        await CollectAsync(client.StreamAsync(SimpleRequest()));

        var body = ParseBody(Assert.Single(handler.Requests));
        Assert.False(body.TryGetProperty("tools", out _));
        Assert.False(body.TryGetProperty("response_format", out _));
        Assert.False(body.TryGetProperty("temperature", out _));
        Assert.False(body.TryGetProperty("max_tokens", out _));
        Assert.False(body.TryGetProperty("reasoning", out _));
        Assert.Equal("test-model", body.GetProperty("model").GetString());
        Assert.True(body.GetProperty("stream").GetBoolean());
    }

    [Fact]
    public async Task Empty_tools_list_is_omitted()
    {
        var handler = new FakeHttpMessageHandler().EnqueueResponse(HttpStatusCode.OK, SimpleStream());
        var (client, _) = NewClient(handler);
        var request = new ChatRequest
        {
            ModelId = "m",
            Messages = new[] { ChatMessage.User("hi") },
            Tools = Array.Empty<ChatToolDefinition>(),
        };

        await CollectAsync(client.StreamAsync(request));

        Assert.False(ParseBody(Assert.Single(handler.Requests)).TryGetProperty("tools", out _));
    }

    // 6. Content order + single terminal finish.
    [Fact]
    public async Task Content_deltas_stream_in_order_then_single_finish()
    {
        var handler = new FakeHttpMessageHandler().EnqueueResponse(HttpStatusCode.OK, EventStream(
            """data: {"choices":[{"delta":{"content":"Hel"}}]}""",
            """data: {"choices":[{"delta":{"content":"lo"}}]}""",
            """data: {"choices":[{"delta":{"content":"!"},"finish_reason":"stop"}]}""",
            "data: [DONE]"));
        var (client, _) = NewClient(handler);

        var deltas = await CollectAsync(client.StreamAsync(SimpleRequest()));

        var contents = deltas.OfType<ChatStreamDelta.Content>().Select(c => c.Text).ToArray();
        Assert.Equal(new[] { "Hel", "lo", "!" }, contents);

        var finish = Assert.IsType<ChatStreamDelta.Finish>(deltas[^1]);
        Assert.Equal(ChatFinishReason.Stop, finish.Reason);
        Assert.Single(deltas.OfType<ChatStreamDelta.Finish>());
    }

    // 7. Reasoning under both field names.
    [Fact]
    public async Task Reasoning_field_yields_reasoning_delta()
    {
        var handler = new FakeHttpMessageHandler().EnqueueResponse(HttpStatusCode.OK, EventStream(
            """data: {"choices":[{"delta":{"reasoning":"thinking"}}]}""",
            """data: {"choices":[{"delta":{"content":"answer"},"finish_reason":"stop"}]}""",
            "data: [DONE]"));
        var (client, _) = NewClient(handler);

        var deltas = await CollectAsync(client.StreamAsync(SimpleRequest()));

        Assert.Equal("thinking", Assert.IsType<ChatStreamDelta.Reasoning>(deltas[0]).Text);
    }

    [Fact]
    public async Task Reasoning_content_field_yields_reasoning_delta()
    {
        var handler = new FakeHttpMessageHandler().EnqueueResponse(HttpStatusCode.OK, EventStream(
            """data: {"choices":[{"delta":{"reasoning_content":"pondering"}}]}""",
            """data: {"choices":[{"delta":{"content":"answer"},"finish_reason":"stop"}]}""",
            "data: [DONE]"));
        var (client, _) = NewClient(handler);

        var deltas = await CollectAsync(client.StreamAsync(SimpleRequest()));

        Assert.Equal("pondering", Assert.IsType<ChatStreamDelta.Reasoning>(deltas[0]).Text);
    }

    // 8. Single tool call assembled from fragmented arguments.
    [Fact]
    public async Task Assembles_fragmented_tool_call()
    {
        var handler = new FakeHttpMessageHandler().EnqueueResponse(HttpStatusCode.OK, EventStream(
            """data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"get_weather","arguments":"{\"ci"}}]}}]}""",
            """data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"ty\":\"NYC\"}"}}]}}]}""",
            """data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}""",
            "data: [DONE]"));
        var (client, _) = NewClient(handler);

        var deltas = await CollectAsync(client.StreamAsync(SimpleRequest()));

        var toolCall = Assert.Single(deltas.OfType<ChatStreamDelta.ToolCall>());
        Assert.Equal("call_1", toolCall.Call.Id);
        Assert.Equal("get_weather", toolCall.Call.Name);
        Assert.Equal("""{"city":"NYC"}""", toolCall.Call.ArgumentsJson);

        Assert.IsType<ChatStreamDelta.ToolCall>(deltas[^2]);
        Assert.Equal(ChatFinishReason.ToolCalls, Assert.IsType<ChatStreamDelta.Finish>(deltas[^1]).Reason);
    }

    // 9. Two parallel tool calls interleaved by index.
    [Fact]
    public async Task Assembles_two_parallel_tool_calls_by_index()
    {
        var handler = new FakeHttpMessageHandler().EnqueueResponse(HttpStatusCode.OK, EventStream(
            """data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_a","function":{"name":"alpha","arguments":"{\"x\":"}}]}}]}""",
            """data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"call_b","function":{"name":"beta","arguments":"{\"y\":"}}]}}]}""",
            """data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"1}"}}]}}]}""",
            """data: {"choices":[{"delta":{"tool_calls":[{"index":1,"function":{"arguments":"2}"}}]}}]}""",
            """data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}""",
            "data: [DONE]"));
        var (client, _) = NewClient(handler);

        var deltas = await CollectAsync(client.StreamAsync(SimpleRequest()));

        var toolCalls = deltas.OfType<ChatStreamDelta.ToolCall>().Select(t => t.Call).ToArray();
        Assert.Equal(2, toolCalls.Length);
        Assert.Equal("call_a", toolCalls[0].Id);
        Assert.Equal("alpha", toolCalls[0].Name);
        Assert.Equal("""{"x":1}""", toolCalls[0].ArgumentsJson);
        Assert.Equal("call_b", toolCalls[1].Id);
        Assert.Equal("beta", toolCalls[1].Name);
        Assert.Equal("""{"y":2}""", toolCalls[1].ArgumentsJson);
    }

    // 10. Usage mapping, yielded before finish.
    [Fact]
    public async Task Usage_chunk_maps_and_precedes_finish()
    {
        var handler = new FakeHttpMessageHandler().EnqueueResponse(HttpStatusCode.OK, EventStream(
            """data: {"choices":[{"delta":{"content":"hi"},"finish_reason":"stop"}]}""",
            """data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":25,"completion_tokens_details":{"reasoning_tokens":5},"cost":0.00042}}""",
            "data: [DONE]"));
        var (client, _) = NewClient(handler);

        var deltas = await CollectAsync(client.StreamAsync(SimpleRequest()));

        var usage = Assert.Single(deltas.OfType<ChatStreamDelta.Usage>());
        Assert.Equal(10, usage.Value.PromptTokens);
        Assert.Equal(25, usage.Value.CompletionTokens);
        Assert.Equal(5, usage.Value.ReasoningTokens);
        Assert.Equal(0.00042m, usage.Value.CostUsd);

        var usageIndex = deltas.FindIndex(d => d is ChatStreamDelta.Usage);
        var finishIndex = deltas.FindIndex(d => d is ChatStreamDelta.Finish);
        Assert.True(usageIndex < finishIndex);
    }

    // 11. finish_reason mapping.
    [Theory]
    [InlineData("stop", ChatFinishReason.Stop)]
    [InlineData("length", ChatFinishReason.Length)]
    [InlineData("content_filter", ChatFinishReason.ContentFilter)]
    [InlineData("weird_new_reason", ChatFinishReason.Other)]
    public async Task Maps_finish_reason(string wire, ChatFinishReason expected)
    {
        var chunk = "data: " + JsonSerializer.Serialize(new
        {
            choices = new[] { new { delta = new { content = "x" }, finish_reason = wire } },
        });
        var handler = new FakeHttpMessageHandler().EnqueueResponse(HttpStatusCode.OK, EventStream(chunk, "data: [DONE]"));
        var (client, _) = NewClient(handler);

        var deltas = await CollectAsync(client.StreamAsync(SimpleRequest()));

        Assert.Equal(expected, Assert.IsType<ChatStreamDelta.Finish>(deltas[^1]).Reason);
    }

    // 12. Keep-alives and a malformed chunk are skipped; stream still completes.
    [Fact]
    public async Task Skips_keepalive_and_malformed_chunks()
    {
        var logger = new TestLogger();
        var handler = new FakeHttpMessageHandler().EnqueueResponse(HttpStatusCode.OK, EventStream(
            ": OPENROUTER PROCESSING",
            """data: {"choices":[{"delta":{"content":"a"}}]}""",
            "data: {not valid json",
            """data: {"choices":[{"delta":{"content":"b"},"finish_reason":"stop"}]}""",
            "data: [DONE]"));
        var (client, _) = NewClient(handler, logger: logger);

        var deltas = await CollectAsync(client.StreamAsync(SimpleRequest()));

        Assert.Equal(new[] { "a", "b" }, deltas.OfType<ChatStreamDelta.Content>().Select(c => c.Text).ToArray());
        Assert.IsType<ChatStreamDelta.Finish>(deltas[^1]);
        Assert.Contains(logger.Entries, e => e.Level == LogLevel.Warning && e.Category == "OpenRouterChatClient");
    }

    // 13. Mid-stream error chunk maps and throws.
    [Fact]
    public async Task Mid_stream_error_throws_mapped_exception()
    {
        var handler = new FakeHttpMessageHandler().EnqueueResponse(HttpStatusCode.OK, EventStream(
            """data: {"choices":[{"delta":{"content":"partial"}}]}""",
            """data: {"error":{"code":429,"message":"rate limited mid-stream"}}""",
            "data: [DONE]"));
        var (client, _) = NewClient(handler);

        var received = new List<ChatStreamDelta>();
        var ex = await Assert.ThrowsAsync<AiClientException>(async () =>
        {
            await foreach (var delta in client.StreamAsync(SimpleRequest()))
            {
                received.Add(delta);
            }
        });

        Assert.Equal(AiClientErrorKind.RateLimited, ex.Kind);
        Assert.Contains(received, d => d is ChatStreamDelta.Content c && c.Text == "partial");
    }

    // 14. Non-retryable status mapping; exactly one request.
    [Theory]
    [InlineData(401, AiClientErrorKind.InvalidApiKey)]
    [InlineData(402, AiClientErrorKind.InsufficientCredits)]
    [InlineData(404, AiClientErrorKind.ModelUnavailable)]
    [InlineData(400, AiClientErrorKind.InvalidRequest)]
    public async Task Maps_http_status_to_kind_without_retry(int status, AiClientErrorKind expected)
    {
        var handler = new FakeHttpMessageHandler().EnqueueResponse(
            (HttpStatusCode)status, """{"error":{"message":"nope"}}""", contentType: "application/json");
        var (client, delays) = NewClient(handler);

        var ex = await Assert.ThrowsAsync<AiClientException>(async () => await CollectAsync(client.StreamAsync(SimpleRequest())));

        Assert.Equal(expected, ex.Kind);
        Assert.Equal(status, ex.HttpStatus);
        Assert.Single(handler.Requests);
        Assert.Empty(delays);
    }

    // 15. Retry on 429 then succeed; growing backoff; Retry-After honored.
    [Fact]
    public async Task Retries_transient_status_then_succeeds_with_growing_backoff()
    {
        var handler = new FakeHttpMessageHandler()
            .EnqueueResponse(HttpStatusCode.TooManyRequests, "{}", contentType: "application/json")
            .EnqueueResponse(HttpStatusCode.TooManyRequests, "{}", contentType: "application/json")
            .EnqueueResponse(HttpStatusCode.OK, SimpleStream());
        var (client, delays) = NewClient(handler);

        var deltas = await CollectAsync(client.StreamAsync(SimpleRequest()));

        Assert.Contains(deltas, d => d is ChatStreamDelta.Content);
        Assert.Equal(3, handler.Requests.Count);
        Assert.Equal(2, delays.Count);
        Assert.True(delays[1] > delays[0], "backoff should grow across attempts");
    }

    [Fact]
    public async Task Honors_retry_after_header()
    {
        var handler = new FakeHttpMessageHandler()
            .EnqueueResponse(
                HttpStatusCode.TooManyRequests,
                "{}",
                contentType: "application/json",
                configureHeaders: h => h.RetryAfter = new RetryConditionHeaderValue(TimeSpan.FromSeconds(1)))
            .EnqueueResponse(HttpStatusCode.OK, SimpleStream());
        var (client, delays) = NewClient(handler);

        await CollectAsync(client.StreamAsync(SimpleRequest()));

        Assert.Equal(2, handler.Requests.Count);
        Assert.Equal(TimeSpan.FromSeconds(1), Assert.Single(delays));
    }

    // 16. Persistent 429 exhausts retries.
    [Fact]
    public async Task Exhausts_retries_on_persistent_rate_limit()
    {
        var handler = new FakeHttpMessageHandler()
            .EnqueueResponse(HttpStatusCode.TooManyRequests, "{}", contentType: "application/json")
            .EnqueueResponse(HttpStatusCode.TooManyRequests, "{}", contentType: "application/json")
            .EnqueueResponse(HttpStatusCode.TooManyRequests, "{}", contentType: "application/json");
        var (client, delays) = NewClient(handler);

        var ex = await Assert.ThrowsAsync<AiClientException>(async () => await CollectAsync(client.StreamAsync(SimpleRequest())));

        Assert.Equal(AiClientErrorKind.RateLimited, ex.Kind);
        Assert.Equal(3, handler.Requests.Count);
        Assert.Equal(2, delays.Count);
    }

    // 17. Persistent 502 → ModelUnavailable; persistent network exception → Network.
    [Fact]
    public async Task Exhausts_retries_on_bad_gateway()
    {
        var handler = new FakeHttpMessageHandler()
            .EnqueueResponse(HttpStatusCode.BadGateway, "", contentType: "application/json")
            .EnqueueResponse(HttpStatusCode.BadGateway, "", contentType: "application/json")
            .EnqueueResponse(HttpStatusCode.BadGateway, "", contentType: "application/json");
        var (client, _) = NewClient(handler);

        var ex = await Assert.ThrowsAsync<AiClientException>(async () => await CollectAsync(client.StreamAsync(SimpleRequest())));

        Assert.Equal(AiClientErrorKind.ModelUnavailable, ex.Kind);
        Assert.Equal(3, handler.Requests.Count);
    }

    [Fact]
    public async Task Retries_transient_network_exception_then_throws_network()
    {
        var handler = new FakeHttpMessageHandler()
            .EnqueueThrow(new HttpRequestException("connection refused"))
            .EnqueueThrow(new HttpRequestException("connection refused"))
            .EnqueueThrow(new HttpRequestException("connection refused"));
        var (client, delays) = NewClient(handler);

        var ex = await Assert.ThrowsAsync<AiClientException>(async () => await CollectAsync(client.StreamAsync(SimpleRequest())));

        Assert.Equal(AiClientErrorKind.Network, ex.Kind);
        Assert.Equal(3, handler.Requests.Count);
        Assert.Equal(2, delays.Count);
    }

    // 18. Cancellation mid-stream propagates as OperationCanceledException.
    [Fact]
    public async Task Cancellation_mid_stream_propagates()
    {
        var handler = new FakeHttpMessageHandler().EnqueueBlockingStream();
        var (client, _) = NewClient(handler);
        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(150));

        await Assert.ThrowsAnyAsync<OperationCanceledException>(async () =>
        {
            await foreach (var _ in client.StreamAsync(SimpleRequest(), cts.Token))
            {
            }
        });
    }

    // 19. [DONE] ends the stream even with trailing data lines.
    [Fact]
    public async Task Done_terminates_stream_and_ignores_trailing_lines()
    {
        var handler = new FakeHttpMessageHandler().EnqueueResponse(HttpStatusCode.OK, EventStream(
            """data: {"choices":[{"delta":{"content":"hi"},"finish_reason":"stop"}]}""",
            "data: [DONE]",
            """data: {"choices":[{"delta":{"content":"IGNORED"}}]}"""));
        var (client, _) = NewClient(handler);

        var deltas = await CollectAsync(client.StreamAsync(SimpleRequest()));

        Assert.Equal(new[] { "hi" }, deltas.OfType<ChatStreamDelta.Content>().Select(c => c.Text).ToArray());
        Assert.DoesNotContain(deltas, d => d is ChatStreamDelta.Content c && c.Text == "IGNORED");
        Assert.Single(deltas.OfType<ChatStreamDelta.Finish>());
    }
}
