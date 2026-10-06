using System;
using System.Linq;
using Mnemo.Core.Models.Keybinds;
using Mnemo.Core.Services;
using Mnemo.Core.Services.Keybinds;
using Mnemo.Core.Services.Search;
using Mnemo.Infrastructure.Services;
using Mnemo.Infrastructure.Services.Search;

namespace Mnemo.Infrastructure.Modules.Flashcards;

/// <summary>
/// Everything the flashcards module contributes that is not a screen: its translations, its
/// place in the navigation, the deck and card search providers, and the study and test chords.
/// The screens themselves are registered by the Avalonia half of this module.
/// </summary>
public sealed class FlashcardsBackendModule : IModule
{
    public void ConfigureServices(IServiceRegistrar services)
    {
        services.AddSingleton<ISearchProvider, DecksSearchProvider>();
        services.AddSingleton<ISearchProvider, FlashcardsSearchProvider>();
    }

    public void RegisterTranslationSources(ITranslationSourceRegistry registry)
    {
        var assembly = typeof(FlashcardsBackendModule).Assembly;
        registry.Add(new EmbeddedJsonTranslationSource(assembly, "Mnemo.Infrastructure.Modules.Flashcards.Translations"));
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
/// Study, test and occlusion editor shortcuts. Each surface gets its own namespace, so keys they
/// share never show as a conflict on the Keyboard settings page.
/// </summary>
internal static class FlashcardsKeybindManifest
{
    public const string SessionNamespace = "flashcards-session";
    public const string TestNamespace = "flashcards-test";
    public const string OcclusionNamespace = "flashcards-occlusion";

    public static readonly KeybindActionDefinition[] Definitions =
    [
        Chords(SessionNamespace, "flashcards-session.close", "Escape"),
        Chords(SessionNamespace, "flashcards-session.undo", "Primary+Z"),
        Chords(SessionNamespace, "flashcards-session.reveal", "Space"),
        Chords(SessionNamespace, "flashcards-session.edit", "E"),
        Chords(SessionNamespace, "flashcards-session.show-masks", "M"),
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

        // The image occlusion editor. Bare letters are safe here: the editor handles them on its own
        // surface, and none of them is a global chord.
        Chords(OcclusionNamespace, "flashcards-occlusion.tool-select", "V"),
        Chords(OcclusionNamespace, "flashcards-occlusion.tool-pan", "H"),
        Chords(OcclusionNamespace, "flashcards-occlusion.tool-rect", "R"),
        Chords(OcclusionNamespace, "flashcards-occlusion.tool-ellipse", "E"),
        Chords(OcclusionNamespace, "flashcards-occlusion.tool-polygon", "P"),
        Chords(OcclusionNamespace, "flashcards-occlusion.finish-polygon", "Return", "Enter"),
        Chords(OcclusionNamespace, "flashcards-occlusion.cancel", "Escape"),
        Chords(OcclusionNamespace, "flashcards-occlusion.previous-mask", "OemOpenBrackets"),
        Chords(OcclusionNamespace, "flashcards-occlusion.next-mask", "OemCloseBrackets"),
        Chords(OcclusionNamespace, "flashcards-occlusion.nudge-left", "Left"),
        Chords(OcclusionNamespace, "flashcards-occlusion.nudge-right", "Right"),
        Chords(OcclusionNamespace, "flashcards-occlusion.nudge-up", "Up"),
        Chords(OcclusionNamespace, "flashcards-occlusion.nudge-down", "Down"),
        Chords(OcclusionNamespace, "flashcards-occlusion.nudge-left-big", "Shift+Left"),
        Chords(OcclusionNamespace, "flashcards-occlusion.nudge-right-big", "Shift+Right"),
        Chords(OcclusionNamespace, "flashcards-occlusion.nudge-up-big", "Shift+Up"),
        Chords(OcclusionNamespace, "flashcards-occlusion.nudge-down-big", "Shift+Down"),
        Chords(OcclusionNamespace, "flashcards-occlusion.move-earlier", "Alt+Shift+Up"),
        Chords(OcclusionNamespace, "flashcards-occlusion.move-later", "Alt+Shift+Down"),
        Chords(OcclusionNamespace, "flashcards-occlusion.rename", "F2"),
        Chords(OcclusionNamespace, "flashcards-occlusion.group", "Primary+G"),
        Chords(OcclusionNamespace, "flashcards-occlusion.ungroup", "Primary+Shift+G"),
        Chords(OcclusionNamespace, "flashcards-occlusion.duplicate", "Primary+D"),
        Chords(OcclusionNamespace, "flashcards-occlusion.select-all", "Primary+A"),
        Chords(OcclusionNamespace, "flashcards-occlusion.delete", "Delete", "Back"),
        Chords(OcclusionNamespace, "flashcards-occlusion.undo", "Primary+Z"),
        Chords(OcclusionNamespace, "flashcards-occlusion.redo", "Primary+Y", "Primary+Shift+Z"),
        Chords(OcclusionNamespace, "flashcards-occlusion.zoom-in", "Primary+OemPlus", "Primary+Shift+OemPlus", "Primary+Add"),
        Chords(OcclusionNamespace, "flashcards-occlusion.zoom-out", "Primary+OemMinus", "Primary+Subtract"),
        Chords(OcclusionNamespace, "flashcards-occlusion.zoom-fit", "Primary+D0", "Primary+NumPad0"),
        Chords(OcclusionNamespace, "flashcards-occlusion.toggle-masks", "M"),
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
