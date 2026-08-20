using System;
using Mnemo.Core.Services;
using Mnemo.UI.Modules.Flashcards.ViewModels;

namespace Mnemo.UI.Modules.Flashcards;

/// <summary>
/// Registers the flashcard library and deck routes. Translations, navigation, search and the
/// study chords are registered by <c>FlashcardsBackendModule</c>, which runs in both shells.
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
    }

    public void RegisterTranslationSources(ITranslationSourceRegistry registry)
    {
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
    }

    public void RegisterTools(IFunctionRegistry registry, IServiceProvider services)
    {
    }

    public void RegisterWidgets(IWidgetRegistry registry, IServiceProvider services)
    {
    }
}
