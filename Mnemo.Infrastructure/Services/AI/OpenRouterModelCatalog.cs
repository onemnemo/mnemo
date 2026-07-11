using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.Sockets;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Ai;
using Mnemo.Core.Services;
using Mnemo.Core.Services.Ai;

namespace Mnemo.Infrastructure.Services.AI;

/// <summary>
/// Fetches and caches OpenRouter's public model catalog, and derives the curated shortlist that
/// settings pickers show by default.
/// </summary>
/// <remarks>
/// The catalog endpoint needs no auth, so a single in-memory cache (TTL below) serves every
/// caller; refreshes are single-flighted so a picker opened by several views at once triggers one
/// HTTP call, not several.
/// </remarks>
public sealed class OpenRouterModelCatalog : IModelCatalogService
{
    private const string ModelsEndpoint = "https://openrouter.ai/api/v1/models";
    private const string LogCategory = "OpenRouterModelCatalog";
    private const string PinnedDefaultModelId = "deepseek/deepseek-v4-flash";
    private const int CuratedPerFamilyCap = 3;
    private const int CuratedOverallCap = 15;

    private static readonly TimeSpan CacheTtl = TimeSpan.FromHours(1);
    private static readonly TimeSpan FetchTimeout = TimeSpan.FromSeconds(30);

    // Ordinal prefixes in shortlist priority order; a model matches at most one (ids don't collide).
    private static readonly string[] CuratedFamilyPrefixes =
    {
        "deepseek/",
        "anthropic/claude",
        "openai/gpt",
        "google/gemini",
        "qwen/",
        "mistralai/",
        "meta-llama/",
    };

    // Used when the provider is unreachable and no catalog entry for the pinned default exists.
    private static readonly ModelDescriptor StaticDefaultDescriptor = new()
    {
        Id = PinnedDefaultModelId,
        DisplayName = "DeepSeek V4 Flash",
        SupportsToolCalls = true,
        SupportsStructuredOutput = true,
    };

    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ILoggerService _logger;
    private readonly Func<DateTimeOffset> _utcNow;
    private readonly SemaphoreSlim _refreshLock = new(1, 1);

    private List<ModelDescriptor>? _cachedModels;
    private DateTimeOffset _cachedAt;

    public OpenRouterModelCatalog(IHttpClientFactory httpClientFactory, ILoggerService logger)
        : this(httpClientFactory, logger, static () => DateTimeOffset.UtcNow)
    {
    }

    // Test seam: the clock is injected so TTL/staleness behavior doesn't need real sleeps.
    internal OpenRouterModelCatalog(IHttpClientFactory httpClientFactory, ILoggerService logger, Func<DateTimeOffset> utcNow)
    {
        _httpClientFactory = httpClientFactory;
        _logger = logger;
        _utcNow = utcNow;
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<ModelDescriptor>> GetCuratedModelsAsync(CancellationToken ct = default)
    {
        IReadOnlyList<ModelDescriptor> catalog;
        try
        {
            catalog = await GetAllModelsAsync(ct).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            // Pickers must always have content, even offline; the pinned default stands in.
            _logger.Warning(LogCategory, $"OpenRouter model catalog unavailable; using the pinned default only. {ex.Message}");
            return new[] { StaticDefaultDescriptor };
        }

        var pinned = catalog.FirstOrDefault(m => string.Equals(m.Id, PinnedDefaultModelId, StringComparison.Ordinal))
            ?? StaticDefaultDescriptor;

        var result = new List<ModelDescriptor> { pinned };
        var familyCounts = CuratedFamilyPrefixes.ToDictionary(p => p, _ => 0, StringComparer.Ordinal);

        foreach (var model in catalog)
        {
            if (result.Count >= CuratedOverallCap)
            {
                break;
            }
            if (string.Equals(model.Id, pinned.Id, StringComparison.Ordinal) || !model.SupportsToolCalls)
            {
                continue;
            }

            var prefix = CuratedFamilyPrefixes.FirstOrDefault(p => model.Id.StartsWith(p, StringComparison.Ordinal));
            if (prefix is null || familyCounts[prefix] >= CuratedPerFamilyCap)
            {
                continue;
            }

            familyCounts[prefix]++;
            result.Add(model);
        }

        return result;
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<ModelDescriptor>> GetAllModelsAsync(CancellationToken ct = default)
    {
        if (TryGetFreshCache(out var fresh))
        {
            return fresh;
        }

        await _refreshLock.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            // Another caller may have refreshed while this one waited for the lock.
            if (TryGetFreshCache(out fresh))
            {
                return fresh;
            }

            List<ModelDescriptor> fetched;
            try
            {
                fetched = await FetchAsync(ct).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (AiClientException ex) when (_cachedModels is not null)
            {
                _logger.Warning(LogCategory, $"OpenRouter model catalog refresh failed ({ex.Kind}); serving the cached catalog.");
                return _cachedModels;
            }

            _cachedModels = fetched;
            _cachedAt = _utcNow();
            return fetched;
        }
        finally
        {
            _refreshLock.Release();
        }
    }

    private bool TryGetFreshCache(out List<ModelDescriptor> models)
    {
        if (_cachedModels is { } cached && _utcNow() - _cachedAt < CacheTtl)
        {
            models = cached;
            return true;
        }
        models = null!;
        return false;
    }

    private async Task<List<ModelDescriptor>> FetchAsync(CancellationToken ct)
    {
        var client = _httpClientFactory.CreateClient(OpenRouterChatClient.HttpClientName);

        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeoutCts.CancelAfter(FetchTimeout);

        HttpResponseMessage response;
        try
        {
            response = await client.GetAsync(ModelsEndpoint, timeoutCts.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            throw new AiClientException(
                AiClientErrorKind.Timeout,
                $"OpenRouter did not return the model catalog within {FetchTimeout.TotalSeconds:F0}s.");
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex) when (ex is HttpRequestException or IOException or SocketException)
        {
            throw new AiClientException(
                AiClientErrorKind.Network, "Network error contacting OpenRouter for the model catalog.", innerException: ex);
        }

        using (response)
        {
            if (!response.IsSuccessStatusCode)
            {
                var status = (int)response.StatusCode;
                throw new AiClientException(
                    OpenRouterErrors.MapStatusToKind(status),
                    $"OpenRouter returned HTTP {status} fetching the model catalog.",
                    httpStatus: status);
            }

            var body = await response.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            try
            {
                return ParseModels(body);
            }
            catch (JsonException ex)
            {
                throw new AiClientException(
                    AiClientErrorKind.Unknown, "OpenRouter returned an unparseable model catalog.", innerException: ex);
            }
        }
    }

    private List<ModelDescriptor> ParseModels(string body)
    {
        var results = new List<ModelDescriptor>();
        using var doc = JsonDocument.Parse(body);
        if (!doc.RootElement.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Array)
        {
            return results;
        }

        foreach (var entry in data.EnumerateArray())
        {
            ModelDescriptor? descriptor;
            try
            {
                descriptor = ParseModel(entry);
            }
            catch (Exception ex)
            {
                // The provider payload is untrusted input; one odd entry must not sink the catalog.
                _logger.Warning(LogCategory, $"Skipping malformed OpenRouter model entry: {ex.Message}");
                continue;
            }

            if (descriptor is not null)
            {
                results.Add(descriptor);
            }
        }

        return results;
    }

    private static ModelDescriptor? ParseModel(JsonElement entry)
    {
        var id = GetString(entry, "id");
        if (string.IsNullOrWhiteSpace(id))
        {
            return null;
        }

        var name = GetString(entry, "name");
        var displayName = string.IsNullOrWhiteSpace(name) ? id : name;

        long? contextLength = entry.TryGetProperty("context_length", out var contextEl)
            && contextEl.ValueKind == JsonValueKind.Number
            && contextEl.TryGetInt64(out var contextValue)
                ? contextValue
                : null;

        decimal? promptPrice = null;
        decimal? completionPrice = null;
        if (entry.TryGetProperty("pricing", out var pricing) && pricing.ValueKind == JsonValueKind.Object)
        {
            promptPrice = ParsePricePerMillion(pricing, "prompt");
            completionPrice = ParsePricePerMillion(pricing, "completion");
        }

        var supported = new HashSet<string>(StringComparer.Ordinal);
        if (entry.TryGetProperty("supported_parameters", out var supportedEl) && supportedEl.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in supportedEl.EnumerateArray())
            {
                if (item.ValueKind == JsonValueKind.String && item.GetString() is { } value)
                {
                    supported.Add(value);
                }
            }
        }

        return new ModelDescriptor
        {
            Id = id,
            DisplayName = displayName,
            ContextLength = contextLength,
            PromptPricePerMillionUsd = promptPrice,
            CompletionPricePerMillionUsd = completionPrice,
            SupportsToolCalls = supported.Contains("tools"),
            SupportsStructuredOutput = supported.Contains("structured_outputs") || supported.Contains("response_format"),
            SupportsReasoning = supported.Contains("reasoning") || supported.Contains("include_reasoning"),
        };
    }

    private static string? GetString(JsonElement entry, string property)
        => entry.TryGetProperty(property, out var el) && el.ValueKind == JsonValueKind.String ? el.GetString() : null;

    private static decimal? ParsePricePerMillion(JsonElement pricing, string property)
    {
        if (!pricing.TryGetProperty(property, out var el) || el.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        var raw = el.GetString();
        return !string.IsNullOrWhiteSpace(raw)
            && decimal.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out var value)
                ? value * 1_000_000m
                : null;
    }
}
