using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Ai;
using Mnemo.Core.Services;
using Mnemo.Core.Services.Ai;

namespace Mnemo.Infrastructure.Services.AI;

/// <summary>
/// Settings-driven role router for the cloud-provider era: every chat-plane role binds to the
/// registered <see cref="IChatModelClient"/> with the model configured for that role, and the
/// text plane reports <see cref="AiRouteStatus.NoBinding"/> until a text client exists.
/// </summary>
/// <remarks>
/// Assistant-grade roles (<see cref="AiRole.Assistant"/>, <see cref="AiRole.StructuredGenerator"/>)
/// use the assistant model; every other role uses the cheaper utility model, so lightweight
/// features never pay assistant-model prices. Settings are read on every resolve, so a key or
/// model changed at runtime applies to the next turn without a restart.
/// </remarks>
public sealed class ModelRouter : IModelRouter
{
    private const string AssistantModelSettingKey = "AI.OpenRouter.AssistantModel";
    private const string UtilityModelSettingKey = "AI.OpenRouter.UtilityModel";
    private const string DefaultModelId = "deepseek/deepseek-v4-flash";

    private readonly IChatModelClient _chatClient;
    private readonly ISettingsService _settings;

    public ModelRouter(IChatModelClient chatClient, ISettingsService settings)
    {
        _chatClient = chatClient;
        _settings = settings;
    }

    /// <inheritdoc />
    public async Task<ChatRouteResult> ResolveChatAsync(AiRole role, CancellationToken ct = default)
    {
        var apiKey = await _settings.GetAsync(OpenRouterChatClient.ApiKeySettingKey, string.Empty).ConfigureAwait(false);
        if (string.IsNullOrWhiteSpace(apiKey))
        {
            return new ChatRouteResult(AiRouteStatus.MissingApiKey);
        }

        var modelSettingKey = role is AiRole.Assistant or AiRole.StructuredGenerator
            ? AssistantModelSettingKey
            : UtilityModelSettingKey;
        var modelId = await _settings.GetAsync(modelSettingKey, DefaultModelId).ConfigureAwait(false);
        if (string.IsNullOrWhiteSpace(modelId))
        {
            modelId = DefaultModelId;
        }

        return new ChatRouteResult(AiRouteStatus.Available, new ChatModelBinding(_chatClient, modelId));
    }

    /// <inheritdoc />
    public Task<TextRouteResult> ResolveTextAsync(AiRole role, CancellationToken ct = default)
        // No text-plane provider exists yet; callers degrade gracefully on NoBinding.
        => Task.FromResult(new TextRouteResult(AiRouteStatus.NoBinding));
}
