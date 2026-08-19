using System.Linq;
using Mnemo.Core.Models.Keybinds;
using Mnemo.Core.Services;
using Mnemo.Core.Services.Keybinds;
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
        foreach (var def in FlashcardsKeybindManifest.Definitions)
            registry.Register(def);
    }
}

/// <summary>
/// Study and test screen shortcuts. The two screens are mutually exclusive surfaces with their
/// own grade keys (a session grades on 1-4, a test on 1-3 plus Enter), so each gets its own
/// namespace rather than sharing one: two actions bound to the same key would otherwise show up
/// as a conflict on the Keyboard settings page even though the two screens can never be open
/// together.
/// </summary>
internal static class FlashcardsKeybindManifest
{
    public const string SessionNamespace = "flashcards-session";
    public const string TestNamespace = "flashcards-test";

    public static readonly KeybindActionDefinition[] Definitions =
    [
        Chords(SessionNamespace, "flashcards-session.close", "Escape"),
        Chords(SessionNamespace, "flashcards-session.undo", "Primary+Z"),
        Chords(SessionNamespace, "flashcards-session.reveal", "Space"),
        Chords(SessionNamespace, "flashcards-session.edit", "E"),
        Chords(SessionNamespace, "flashcards-session.grade-again", "D1"),
        Chords(SessionNamespace, "flashcards-session.grade-hard", "D2"),
        Chords(SessionNamespace, "flashcards-session.grade-good", "D3"),
        Chords(SessionNamespace, "flashcards-session.grade-easy", "D4"),

        Chords(TestNamespace, "flashcards-test.close", "Escape"),
        Chords(TestNamespace, "flashcards-test.undo", "Primary+Z"),
        Chords(TestNamespace, "flashcards-test.edit", "E"),
        Chords(TestNamespace, "flashcards-test.grade-missed", "D1"),
        Chords(TestNamespace, "flashcards-test.grade-close", "D2"),
        // Enter and the "3" key are two different ways to say the same grade, the way
        // mindmap.enter answers to both Return and Enter.
        Chords(TestNamespace, "flashcards-test.grade-got-it", "D3", "Return", "Enter"),
    ];

    private static KeybindActionDefinition Chords(string ns, string actionId, params string[] gestures) =>
        new()
        {
            ActionId = actionId,
            Namespace = ns,
            Scope = KeybindScope.Local,
            Enabled = true,
            Module = "flashcards",
            DisplayLabelKey = actionId,
            DisplayCategoryKey = $"category.{ns}",
            Bindings = gestures
                .Select(g => new KeybindBindingEntry
                {
                    Kind = KeybindBindingKind.Chord,
                    Chord = CanonicalKeyGestureCodec.ParseChord(g),
                })
                .ToArray(),
        };
}
