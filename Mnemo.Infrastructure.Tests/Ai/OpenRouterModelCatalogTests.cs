using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.Tasks;
using Mnemo.Core.Enums;
using Mnemo.Core.Models.Ai;
using Mnemo.Infrastructure.Services.AI;

namespace Mnemo.Infrastructure.Tests.Ai;

public class OpenRouterModelCatalogTests
{
    private const string PinnedDefaultId = "deepseek/deepseek-v4-flash";
    private const string ModelsUrl = "https://openrouter.ai/api/v1/models";

    private static OpenRouterModelCatalog NewCatalog(
        FakeHttpMessageHandler handler, TestLogger? logger = null, Func<DateTimeOffset>? utcNow = null)
        => new(new FakeHttpClientFactory(handler), logger ?? new TestLogger(), utcNow ?? (static () => DateTimeOffset.UtcNow));

    private static ModelEntryDto ToolModel(string id) => new() { Id = id, Name = id, SupportedParameters = new[] { "tools" } };

    private static ModelEntryDto NonToolModel(string id) => new() { Id = id, Name = id, SupportedParameters = Array.Empty<string>() };

    private static string CatalogJson(params ModelEntryDto[] models)
        => JsonSerializer.Serialize(new CatalogResponseDto { Data = models.ToList() });

    private static string CatalogJsonRaw(params string[] rawEntries)
        => "{\"data\":[" + string.Join(",", rawEntries) + "]}";

    // 1. Full field mapping: pricing multiplied to per-million, capability flags, name fallback,
    //    and the request itself (method + URL).
    [Fact]
    public async Task Parses_full_model_entry_and_requests_correct_url()
    {
        var entry = new ModelEntryDto
        {
            Id = "anthropic/claude-3-5-sonnet",
            Name = "Claude 3.5 Sonnet",
            ContextLength = 200_000,
            Pricing = new PricingDto { Prompt = "0.0000006", Completion = "0.0000012" },
            SupportedParameters = new[] { "tools", "structured_outputs", "reasoning" },
        };
        var handler = new FakeHttpMessageHandler().EnqueueResponse(HttpStatusCode.OK, CatalogJson(entry), "application/json");
        var catalog = NewCatalog(handler);

        var models = await catalog.GetAllModelsAsync();

        var model = Assert.Single(models);
        Assert.Equal("anthropic/claude-3-5-sonnet", model.Id);
        Assert.Equal("Claude 3.5 Sonnet", model.DisplayName);
        Assert.Equal(200_000, model.ContextLength);
        Assert.Equal(0.6m, model.PromptPricePerMillionUsd);
        Assert.Equal(1.2m, model.CompletionPricePerMillionUsd);
        Assert.True(model.SupportsToolCalls);
        Assert.True(model.SupportsStructuredOutput);
        Assert.True(model.SupportsReasoning);

        var recorded = Assert.Single(handler.Requests);
        Assert.Equal(HttpMethod.Get, recorded.Method);
        Assert.Equal(ModelsUrl, recorded.Uri!.ToString());
    }

    [Fact]
    public async Task Falls_back_to_id_and_defaults_when_optional_fields_absent()
    {
        var entry = new ModelEntryDto { Id = "bare/model" };
        var handler = new FakeHttpMessageHandler().EnqueueResponse(HttpStatusCode.OK, CatalogJson(entry), "application/json");
        var catalog = NewCatalog(handler);

        var model = Assert.Single(await catalog.GetAllModelsAsync());

        Assert.Equal("bare/model", model.DisplayName);
        Assert.Null(model.ContextLength);
        Assert.Null(model.PromptPricePerMillionUsd);
        Assert.Null(model.CompletionPricePerMillionUsd);
        Assert.False(model.SupportsToolCalls);
        Assert.False(model.SupportsStructuredOutput);
        Assert.False(model.SupportsReasoning);
    }

    // 2. A structurally malformed entry (not even a JSON object) is skipped with a warning;
    //    a blank-id entry is skipped silently; the valid entry still parses.
    [Fact]
    public async Task Skips_malformed_and_blank_id_entries_but_parses_the_rest()
    {
        var logger = new TestLogger();
        var body = CatalogJsonRaw(
            JsonSerializer.Serialize(ToolModel("good/model")),
            JsonSerializer.Serialize(new ModelEntryDto { Id = "", Name = "no id" }),
            "\"not-an-object\"");
        var handler = new FakeHttpMessageHandler().EnqueueResponse(HttpStatusCode.OK, body, "application/json");
        var catalog = NewCatalog(handler, logger);

        var models = await catalog.GetAllModelsAsync();

        var model = Assert.Single(models);
        Assert.Equal("good/model", model.Id);
        Assert.Equal(1, logger.Entries.Count(e => e.Level == LogLevel.Warning));
    }

    // 3. Curated: pinned default first, tool-capable family filter applied, off-family and
    //    non-tool models excluded.
    [Fact]
    public async Task Curated_list_has_pinned_default_first_and_filters_by_family_and_tool_support()
    {
        var handler = new FakeHttpMessageHandler().EnqueueResponse(HttpStatusCode.OK, CatalogJson(
            ToolModel(PinnedDefaultId),
            ToolModel("anthropic/claude-3-5-sonnet"),
            ToolModel("openai/gpt-4o"),
            NonToolModel("openai/gpt-3.5-turbo"),
            ToolModel("google/gemini-1.5-pro"),
            ToolModel("qwen/qwen-2.5-72b"),
            ToolModel("mistralai/mistral-large"),
            ToolModel("meta-llama/llama-3.1-70b"),
            ToolModel("cohere/command-r")), "application/json");
        var catalog = NewCatalog(handler);

        var curated = await catalog.GetCuratedModelsAsync();

        Assert.Equal(PinnedDefaultId, curated[0].Id);
        var ids = curated.Select(m => m.Id).ToArray();
        Assert.Contains("anthropic/claude-3-5-sonnet", ids);
        Assert.Contains("openai/gpt-4o", ids);
        Assert.Contains("google/gemini-1.5-pro", ids);
        Assert.Contains("qwen/qwen-2.5-72b", ids);
        Assert.Contains("mistralai/mistral-large", ids);
        Assert.Contains("meta-llama/llama-3.1-70b", ids);
        Assert.DoesNotContain("cohere/command-r", ids);
        Assert.DoesNotContain("openai/gpt-3.5-turbo", ids);
        Assert.Equal(7, curated.Count);
    }

    // 4. At most 3 models per family, in catalog order.
    [Fact]
    public async Task Curated_list_caps_at_three_models_per_family()
    {
        var handler = new FakeHttpMessageHandler().EnqueueResponse(HttpStatusCode.OK, CatalogJson(
            ToolModel(PinnedDefaultId),
            ToolModel("anthropic/claude-1"),
            ToolModel("anthropic/claude-2"),
            ToolModel("anthropic/claude-3"),
            ToolModel("anthropic/claude-4")), "application/json");
        var catalog = NewCatalog(handler);

        var curated = await catalog.GetCuratedModelsAsync();

        var ids = curated.Select(m => m.Id).ToArray();
        Assert.Equal(4, ids.Length); // pinned + 3
        Assert.Contains("anthropic/claude-1", ids);
        Assert.Contains("anthropic/claude-2", ids);
        Assert.Contains("anthropic/claude-3", ids);
        Assert.DoesNotContain("anthropic/claude-4", ids);
    }

    // 5. Overall cap of 15, pinned default always occupying the first slot.
    [Fact]
    public async Task Curated_list_caps_at_fifteen_overall()
    {
        var models = new List<ModelEntryDto> { ToolModel(PinnedDefaultId) };
        foreach (var family in new[] { "anthropic/claude", "openai/gpt", "google/gemini", "qwen/q", "mistralai/m", "meta-llama/l" })
        {
            models.Add(ToolModel($"{family}-1"));
            models.Add(ToolModel($"{family}-2"));
            models.Add(ToolModel($"{family}-3"));
        }
        var handler = new FakeHttpMessageHandler().EnqueueResponse(HttpStatusCode.OK, CatalogJson(models.ToArray()), "application/json");
        var catalog = NewCatalog(handler);

        var curated = await catalog.GetCuratedModelsAsync();

        Assert.Equal(15, curated.Count);
        Assert.Equal(PinnedDefaultId, curated[0].Id);
        var ids = curated.Select(m => m.Id).ToArray();
        // First four families (12 entries) plus pinned (1) plus two of the fifth family fit in 15;
        // the sixth family (meta-llama) is entirely past the cap.
        Assert.DoesNotContain("meta-llama/l-1", ids);
        Assert.DoesNotContain("meta-llama/l-2", ids);
        Assert.DoesNotContain("meta-llama/l-3", ids);
    }

    // 6. Pinned default missing from the catalog: injected from the static descriptor.
    [Fact]
    public async Task Curated_injects_static_default_when_pinned_model_missing_from_catalog()
    {
        var handler = new FakeHttpMessageHandler().EnqueueResponse(HttpStatusCode.OK, CatalogJson(
            ToolModel("anthropic/claude-3-5-sonnet")), "application/json");
        var catalog = NewCatalog(handler);

        var curated = await catalog.GetCuratedModelsAsync();

        var pinned = curated[0];
        Assert.Equal(PinnedDefaultId, pinned.Id);
        Assert.Equal("DeepSeek V4 Flash", pinned.DisplayName);
        Assert.True(pinned.SupportsToolCalls);
        Assert.True(pinned.SupportsStructuredOutput);
        Assert.False(pinned.SupportsReasoning);
        Assert.Null(pinned.ContextLength);
        Assert.Null(pinned.PromptPricePerMillionUsd);
        Assert.Contains(curated, m => m.Id == "anthropic/claude-3-5-sonnet");
    }

    // 7. Provider entirely unreachable: curated returns exactly the static default, never throws.
    [Fact]
    public async Task Curated_returns_static_default_only_when_provider_unreachable()
    {
        var handler = new FakeHttpMessageHandler().EnqueueThrow(new HttpRequestException("connection refused"));
        var catalog = NewCatalog(handler);

        var curated = await catalog.GetCuratedModelsAsync();

        var pinned = Assert.Single(curated);
        Assert.Equal(PinnedDefaultId, pinned.Id);
        Assert.Equal("DeepSeek V4 Flash", pinned.DisplayName);
        Assert.True(pinned.SupportsToolCalls);
        Assert.True(pinned.SupportsStructuredOutput);
    }

    // 8. TTL: repeated calls inside the window are served from cache; expiry triggers a refetch.
    [Fact]
    public async Task Caches_within_ttl_and_refetches_after_expiry()
    {
        var handler = new FakeHttpMessageHandler()
            .EnqueueResponse(HttpStatusCode.OK, CatalogJson(ToolModel("a/one")), "application/json")
            .EnqueueResponse(HttpStatusCode.OK, CatalogJson(ToolModel("a/two")), "application/json");
        var clock = new MutableClock();
        var catalog = NewCatalog(handler, utcNow: clock.UtcNow);

        var first = await catalog.GetAllModelsAsync();
        var second = await catalog.GetAllModelsAsync();
        Assert.Single(handler.Requests);
        Assert.Equal("a/one", Assert.Single(first).Id);
        Assert.Equal("a/one", Assert.Single(second).Id);

        clock.Now += TimeSpan.FromHours(1) + TimeSpan.FromSeconds(1);
        var third = await catalog.GetAllModelsAsync();

        Assert.Equal(2, handler.Requests.Count);
        Assert.Equal("a/two", Assert.Single(third).Id);
    }

    // 9. Stale-on-failure: a good fetch, then expiry, then a failing refresh serves the stale copy.
    [Fact]
    public async Task Serves_stale_cache_when_refresh_fails_after_expiry()
    {
        var logger = new TestLogger();
        var handler = new FakeHttpMessageHandler()
            .EnqueueResponse(HttpStatusCode.OK, CatalogJson(ToolModel("a/one")), "application/json")
            .EnqueueResponse(HttpStatusCode.InternalServerError, "{}", "application/json");
        var clock = new MutableClock();
        var catalog = NewCatalog(handler, logger, clock.UtcNow);

        await catalog.GetAllModelsAsync();
        clock.Now += TimeSpan.FromHours(2);
        var stale = await catalog.GetAllModelsAsync();

        Assert.Equal("a/one", Assert.Single(stale).Id);
        Assert.Equal(2, handler.Requests.Count);
        Assert.Contains(logger.Entries, e => e.Level == LogLevel.Warning);
    }

    // 10. No cache and a failed fetch: throws AiClientException with the mapped kind.
    [Fact]
    public async Task GetAllModels_with_no_cache_and_server_error_throws_mapped_exception()
    {
        var handler = new FakeHttpMessageHandler().EnqueueResponse(HttpStatusCode.InternalServerError, "{}", "application/json");
        var catalog = NewCatalog(handler);

        var ex = await Assert.ThrowsAsync<AiClientException>(() => catalog.GetAllModelsAsync());

        Assert.Equal(AiClientErrorKind.Unknown, ex.Kind);
        Assert.Equal(500, ex.HttpStatus);
    }

    [Fact]
    public async Task GetAllModels_with_no_cache_and_transport_failure_throws_network()
    {
        var handler = new FakeHttpMessageHandler().EnqueueThrow(new HttpRequestException("connection refused"));
        var catalog = NewCatalog(handler);

        var ex = await Assert.ThrowsAsync<AiClientException>(() => catalog.GetAllModelsAsync());

        Assert.Equal(AiClientErrorKind.Network, ex.Kind);
    }

    private sealed class MutableClock
    {
        public DateTimeOffset Now { get; set; } = DateTimeOffset.UtcNow;
        public DateTimeOffset UtcNow() => Now;
    }

    private sealed class ModelEntryDto
    {
        [JsonPropertyName("id")] public string? Id { get; set; }
        [JsonPropertyName("name")] public string? Name { get; set; }
        [JsonPropertyName("context_length")] public long? ContextLength { get; set; }
        [JsonPropertyName("pricing")] public PricingDto? Pricing { get; set; }
        [JsonPropertyName("supported_parameters")] public string[]? SupportedParameters { get; set; }
    }

    private sealed class PricingDto
    {
        [JsonPropertyName("prompt")] public string? Prompt { get; set; }
        [JsonPropertyName("completion")] public string? Completion { get; set; }
    }

    private sealed class CatalogResponseDto
    {
        [JsonPropertyName("data")] public List<ModelEntryDto> Data { get; set; } = new();
    }
}
