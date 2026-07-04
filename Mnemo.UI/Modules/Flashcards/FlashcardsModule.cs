using Mnemo.Core.Models.Keybinds;
using Mnemo.Core.Services;
using Mnemo.Core.Services.Keybinds;
using Mnemo.Core.Services.Search;
using Mnemo.Infrastructure.Services;
using Mnemo.Infrastructure.Services.Search;
using Mnemo.UI.Modules.Flashcards.ViewModels;

namespace Mnemo.UI.Modules.Flashcards;

/// <summary>
/// Registers flashcard library, deck detail, and practice routes.
/// </summary>
public class FlashcardsModule : IModule
{
    public void ConfigureServices(IServiceRegistrar services)
    {
        services.AddTransient<FlashcardsViewModel>();
        services.AddTransient<FlashcardDeckDetailViewModel>();
        services.AddTransient<FlashcardPracticeViewModel>();
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
        registry.RegisterRoute("flashcard-deck", typeof(FlashcardDeckDetailViewModel));
        registry.RegisterRoute("flashcard-practice", typeof(FlashcardPracticeViewModel));
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
            childRoutes: ["flashcard-deck", "flashcard-practice"]);
    }

    public void RegisterTools(IFunctionRegistry registry, IServiceProvider services)
    {
    }

    public void RegisterWidgets(IWidgetRegistry registry, IServiceProvider services)
    {
    }

    public void RegisterKeybindManifest(IKeybindManifestRegistry registry)
    {
        foreach (var def in FlashcardKeybindManifest.Definitions)
            registry.Register(def);
    }
}

internal static class FlashcardKeybindManifest
{
    public const string Namespace = "editor";

    public static readonly KeybindActionDefinition[] Definitions =
    [
        new()
        {
            ActionId = "flashcard.save-and-new",
            Namespace = Namespace,
            Scope = KeybindScope.Local,
            Enabled = true,
            Module = "flashcards",
            DisplayLabelKey = "flashcard.save-and-new",
            DisplayCategoryKey = "category.flashcards_deck",
            Bindings =
            [
                new KeybindBindingEntry
                {
                    Kind = KeybindBindingKind.Chord,
                    Chord = CanonicalKeyGestureCodec.ParseChord("Primary+Enter"),
                },
            ],
        },
        new()
        {
            ActionId = "flashcard.wrap-cloze",
            Namespace = Namespace,
            Scope = KeybindScope.Local,
            Enabled = true,
            Module = "flashcards",
            DisplayLabelKey = "flashcard.wrap-cloze",
            DisplayDescriptionKey = "flashcard.wrap-cloze.description",
            DisplayCategoryKey = "category.flashcards_deck",
            Bindings =
            [
                new KeybindBindingEntry
                {
                    Kind = KeybindBindingKind.Chord,
                    Chord = CanonicalKeyGestureCodec.ParseChord("Primary+Shift+C"),
                },
            ],
        },
    ];
}
