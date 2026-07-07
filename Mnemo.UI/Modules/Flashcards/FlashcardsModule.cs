using Mnemo.Core.Services;
using Mnemo.Core.Services.Search;
using Mnemo.Infrastructure.Services;
using Mnemo.Infrastructure.Services.Search;
using Mnemo.UI.Modules.Flashcards.ViewModels;

namespace Mnemo.UI.Modules.Flashcards;

/// <summary>
/// Registers the flashcard library and deck routes.
/// </summary>
public class FlashcardsModule : IModule
{
    public void ConfigureServices(IServiceRegistrar services)
    {
        services.AddTransient<FlashcardsViewModel>();
        services.AddTransient<FlashcardDeckViewModel>();
        services.AddTransient<FlashcardSessionViewModel>();
        services.AddTransient<FlashcardTestViewModel>();
        services.AddTransient<FlashcardReviewSettingsViewModel>();
        services.AddTransient<FlashcardCardEditorViewModel>();
        services.AddSingleton<ISearchProvider, DecksSearchProvider>();
        services.AddSingleton<ISearchProvider, FlashcardsSearchProvider>();
    }

    public void RegisterTranslationSources(ITranslationSourceRegistry registry)
    {
        var assembly = typeof(FlashcardsModule).Assembly;
        registry.Add(new EmbeddedJsonTranslationSource(assembly, "Mnemo.UI.Modules.Flashcards.Translations"));
    }

    public void RegisterRoutes(INavigationRegistry registry)
    {
        registry.RegisterRoute("flashcards", typeof(FlashcardsViewModel));
        registry.RegisterRoute("flashcard-deck", typeof(FlashcardDeckViewModel));
        registry.RegisterRoute("flashcard-session", typeof(FlashcardSessionViewModel));
        registry.RegisterRoute("flashcard-test", typeof(FlashcardTestViewModel));
    }

    public void RegisterSidebarItems(ISidebarService sidebarService)
    {
        sidebarService.RegisterItem(
            "Flashcards",
            "flashcards",
            "avares://Mnemo.UI/Icons/Sidebar/flashcard.svg",
            "Modules",
            1,
            40,
            childRoutes: ["flashcard-deck", "flashcard-session", "flashcard-test"]);
    }

    public void RegisterTools(IFunctionRegistry registry, IServiceProvider services)
    {
    }

    public void RegisterWidgets(IWidgetRegistry registry, IServiceProvider services)
    {
    }

    public void RegisterKeybindManifest(IKeybindManifestRegistry registry)
    {
    }
}
