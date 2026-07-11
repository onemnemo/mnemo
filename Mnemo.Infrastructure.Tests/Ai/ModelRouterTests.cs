using System.Threading.Tasks;
using Mnemo.Core.Models.Ai;
using Mnemo.Core.Services.Ai;
using Mnemo.Infrastructure.Services.AI;

namespace Mnemo.Infrastructure.Tests.Ai;

public class ModelRouterTests
{
    private const string ApiKeyKey = "AI.OpenRouter.ApiKey";
    private const string AssistantModelKey = "AI.OpenRouter.AssistantModel";
    private const string UtilityModelKey = "AI.OpenRouter.UtilityModel";
    private const string PinnedDefaultModel = "deepseek/deepseek-v4-flash";

    private readonly ScriptedChatModelClient _chatClient = new();

    private ModelRouter NewRouter(FakeSettingsService settings) => new(_chatClient, settings);

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Missing_or_blank_api_key_reports_missing_key(string? key)
    {
        var settings = new FakeSettingsService();
        if (key is not null)
        {
            settings.Set(ApiKeyKey, key);
        }

        var result = await NewRouter(settings).ResolveChatAsync(AiRole.Assistant);

        Assert.Equal(AiRouteStatus.MissingApiKey, result.Status);
        Assert.Null(result.Binding);
    }

    [Theory]
    [InlineData(AiRole.Assistant)]
    [InlineData(AiRole.StructuredGenerator)]
    public async Task Assistant_grade_roles_bind_the_assistant_model(AiRole role)
    {
        var settings = new FakeSettingsService()
            .Set(ApiKeyKey, "key")
            .Set(AssistantModelKey, "vendor/assistant-model")
            .Set(UtilityModelKey, "vendor/utility-model");

        var result = await NewRouter(settings).ResolveChatAsync(role);

        Assert.Equal(AiRouteStatus.Available, result.Status);
        Assert.NotNull(result.Binding);
        Assert.Same(_chatClient, result.Binding!.Client);
        Assert.Equal("vendor/assistant-model", result.Binding.ModelId);
    }

    [Theory]
    [InlineData(AiRole.Summarizer)]
    [InlineData(AiRole.Rewriter)]
    [InlineData(AiRole.TabCompleter)]
    [InlineData(AiRole.TitleGenerator)]
    public async Task Utility_roles_bind_the_utility_model_on_the_chat_plane(AiRole role)
    {
        var settings = new FakeSettingsService()
            .Set(ApiKeyKey, "key")
            .Set(AssistantModelKey, "vendor/assistant-model")
            .Set(UtilityModelKey, "vendor/utility-model");

        var result = await NewRouter(settings).ResolveChatAsync(role);

        Assert.Equal(AiRouteStatus.Available, result.Status);
        Assert.Equal("vendor/utility-model", result.Binding!.ModelId);
    }

    [Theory]
    [InlineData(AiRole.Assistant)]
    [InlineData(AiRole.Summarizer)]
    public async Task Unset_model_falls_back_to_the_pinned_default(AiRole role)
    {
        var settings = new FakeSettingsService().Set(ApiKeyKey, "key");

        var result = await NewRouter(settings).ResolveChatAsync(role);

        Assert.Equal(AiRouteStatus.Available, result.Status);
        Assert.Equal(PinnedDefaultModel, result.Binding!.ModelId);
    }

    [Fact]
    public async Task Blank_model_setting_falls_back_to_the_pinned_default()
    {
        var settings = new FakeSettingsService()
            .Set(ApiKeyKey, "key")
            .Set(AssistantModelKey, "   ");

        var result = await NewRouter(settings).ResolveChatAsync(AiRole.Assistant);

        Assert.Equal(PinnedDefaultModel, result.Binding!.ModelId);
    }

    [Fact]
    public async Task Text_plane_reports_no_binding()
    {
        var settings = new FakeSettingsService().Set(ApiKeyKey, "key");

        var result = await NewRouter(settings).ResolveTextAsync(AiRole.Summarizer);

        Assert.Equal(AiRouteStatus.NoBinding, result.Status);
        Assert.Null(result.Binding);
    }

    [Fact]
    public async Task Key_added_at_runtime_applies_to_the_next_resolve()
    {
        var settings = new FakeSettingsService();
        var router = NewRouter(settings);
        Assert.Equal(AiRouteStatus.MissingApiKey, (await router.ResolveChatAsync(AiRole.Assistant)).Status);

        settings.Set(ApiKeyKey, "key");

        Assert.Equal(AiRouteStatus.Available, (await router.ResolveChatAsync(AiRole.Assistant)).Status);
    }
}
