using System;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Sockets;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Ai;
using Mnemo.Core.Services;
using Mnemo.Core.Services.Ai;

namespace Mnemo.Infrastructure.Services.AI;

/// <summary>
/// Checks an OpenRouter API key against the provider's auth endpoint for the settings page's
/// "test connection" action.
/// </summary>
/// <remarks>The key is never logged; a failed validation logs the HTTP status only.</remarks>
public sealed class OpenRouterKeyValidator : IAiKeyValidator
{
    private const string Endpoint = "https://openrouter.ai/api/v1/auth/key";
    private const string LogCategory = "OpenRouterKeyValidator";
    private static readonly TimeSpan RequestTimeout = TimeSpan.FromSeconds(15);

    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ILoggerService _logger;

    public OpenRouterKeyValidator(IHttpClientFactory httpClientFactory, ILoggerService logger)
    {
        _httpClientFactory = httpClientFactory;
        _logger = logger;
    }

    /// <inheritdoc />
    public async Task<AiKeyValidationResult> ValidateAsync(string apiKey, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(apiKey))
        {
            return new AiKeyValidationResult(false, AiClientErrorKind.InvalidApiKey);
        }

        var client = _httpClientFactory.CreateClient(OpenRouterChatClient.HttpClientName);

        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeoutCts.CancelAfter(RequestTimeout);

        using var request = new HttpRequestMessage(HttpMethod.Get, Endpoint);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);

        HttpResponseMessage response;
        try
        {
            response = await client.SendAsync(request, timeoutCts.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            _logger.Warning(LogCategory, "OpenRouter key validation timed out.");
            return new AiKeyValidationResult(false, AiClientErrorKind.Timeout);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex) when (ex is HttpRequestException or IOException or SocketException)
        {
            _logger.Warning(LogCategory, $"OpenRouter key validation failed: network error ({ex.GetType().Name}).");
            return new AiKeyValidationResult(false, AiClientErrorKind.Network);
        }

        using (response)
        {
            if (!response.IsSuccessStatusCode)
            {
                var status = (int)response.StatusCode;
                _logger.Warning(LogCategory, $"OpenRouter key validation failed with HTTP {status}.");
                return new AiKeyValidationResult(false, OpenRouterErrors.MapStatusToKind(status));
            }

            string body;
            try
            {
                body = await response.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception ex) when (ex is HttpRequestException or IOException or SocketException)
            {
                _logger.Warning(LogCategory, $"OpenRouter key validation failed: network error reading the response ({ex.GetType().Name}).");
                return new AiKeyValidationResult(false, AiClientErrorKind.Network);
            }

            return ParseSuccessBody(body);
        }
    }

    private static AiKeyValidationResult ParseSuccessBody(string body)
    {
        try
        {
            using var doc = JsonDocument.Parse(body);
            var root = doc.RootElement;

            // OpenRouter nests usage/limit under "data"; tolerate them at the root too.
            var scope = root.ValueKind == JsonValueKind.Object
                && root.TryGetProperty("data", out var data)
                && data.ValueKind == JsonValueKind.Object
                    ? data
                    : root;

            return new AiKeyValidationResult(true, null, GetDecimal(scope, "usage"), GetDecimal(scope, "limit"));
        }
        catch (JsonException)
        {
            // The key was still accepted; an unreadable body just means credits are unknown.
            return new AiKeyValidationResult(true);
        }
    }

    private static decimal? GetDecimal(JsonElement scope, string property)
        => scope.ValueKind == JsonValueKind.Object
            && scope.TryGetProperty(property, out var el)
            && el.ValueKind == JsonValueKind.Number
            && el.TryGetDecimal(out var value)
                ? value
                : null;
}
