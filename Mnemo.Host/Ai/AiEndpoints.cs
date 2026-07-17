using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Mnemo.Core.Models.Ai;
using Mnemo.Core.Services;
using Mnemo.Core.Services.Ai;
using Mnemo.Host.Contracts;

namespace Mnemo.Host.Ai;

/// <summary>
/// The AI configuration surface the chat settings depend on: the provider model catalog
/// for pickers, the "test connection" key check, and the global web-search toggle. All read
/// the same services and setting keys the desktop app uses, so the two UIs stay in sync
/// against one database during the parallel phase.
/// </summary>
public static class AiEndpoints
{
    // Mirror the keys the desktop's SettingsViewModel / ChatViewModel read and write.
    private const string WebSearchEnabledKey = "AI.WebSearch.Enabled";
    private const string ApiKeyKey = "AI.OpenRouter.ApiKey";

    public static void MapAi(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/ai/models", async (string? scope, IModelCatalogService catalog, CancellationToken ct) =>
        {
            // Curated (the picker shortlist) is the default; ?scope=all returns the full catalog.
            var all = string.Equals(scope, "all", StringComparison.OrdinalIgnoreCase);
            try
            {
                var models = all
                    ? await catalog.GetAllModelsAsync(ct).ConfigureAwait(false)
                    : await catalog.GetCuratedModelsAsync(ct).ConfigureAwait(false);
                return Results.Ok(models.Select(AiModelDto.FromModel).ToList());
            }
            catch (AiClientException ex)
            {
                // Only the full catalog throws; curated always falls back to the pinned default.
                return Results.Json(
                    new ErrorDto(AiErrorMapping.ToWire(ex.Kind), ex.Message),
                    statusCode: AiErrorMapping.ToHttpStatus(ex.Kind));
            }
        });

        endpoints.MapPost("/api/ai/validate-key", async (AiKeyValidationRequestDto? request, IAiKeyValidator validator, ISettingsService settings, CancellationToken ct) =>
        {
            // Test the typed key when one is supplied; otherwise fall back to the saved key,
            // which the SPA cannot send because secrets are write-only over the API.
            var key = request?.ApiKey;
            if (string.IsNullOrWhiteSpace(key))
                key = await settings.GetAsync(ApiKeyKey, string.Empty).ConfigureAwait(false);

            var result = await validator.ValidateAsync(key ?? string.Empty, ct).ConfigureAwait(false);
            return Results.Ok(AiKeyValidationResultDto.FromModel(result));
        });

        endpoints.MapGet("/api/ai/settings", async (ISettingsService settings) =>
        {
            var webSearchEnabled = await settings.GetAsync(WebSearchEnabledKey, true).ConfigureAwait(false);
            return new AiSettingsDto(webSearchEnabled);
        });

        endpoints.MapPut("/api/ai/settings/web-search", async (UpdateBoolSettingDto body, ISettingsService settings) =>
        {
            // Store a real boolean (not a string) so the desktop's GetAsync<bool> reads it back.
            await settings.SetAsync(WebSearchEnabledKey, body.Value).ConfigureAwait(false);
            return Results.NoContent();
        });
    }
}
