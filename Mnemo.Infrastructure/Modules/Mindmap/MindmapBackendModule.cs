using System;
using System.Linq;
using Mnemo.Core.Models.Keybinds;
using Mnemo.Core.Services;
using Mnemo.Core.Services.Keybinds;
using Microsoft.Extensions.DependencyInjection;
using Mnemo.Infrastructure.Services;
using Mnemo.Infrastructure.Services.Mindmap;
using Mnemo.Infrastructure.Services.Mindmap.Layout;
using Mnemo.Infrastructure.Services.Mindmap.Persistence;
using Mnemo.Infrastructure.Services.Mindmap.Style;
using Mnemo.Infrastructure.Services.Mindmap.Tools;
using Mnemo.Infrastructure.Services.Tools;

namespace Mnemo.Infrastructure.Modules.Mindmap;

/// <summary>
/// Schema v2 mindmap module: registers the document store and service, the layout engine, the
/// style cascade, the translations, the navigation entry, the assistant's map tools and the
/// canvas chords. The canvas editor itself is registered by the Avalonia half of this module.
/// </summary>
public sealed class MindmapBackendModule : IModule
{
    public void ConfigureServices(IServiceRegistrar services)
    {
        services.AddSingleton<IMindmapStore, MindmapStore>();
        services.AddSingleton<IMindmapService, MindmapDocumentService>();

        // Layout engine: the six built-in algorithms plus the dispatching service.
        services.AddSingleton<IMindmapLayoutProvider, BalancedLayoutProvider>();
        services.AddSingleton<IMindmapLayoutProvider, TreeRightLayoutProvider>();
        services.AddSingleton<IMindmapLayoutProvider, TreeDownLayoutProvider>();
        services.AddSingleton<IMindmapLayoutProvider, RadialLayoutProvider>();
        services.AddSingleton<IMindmapLayoutProvider, TimelineLayoutProvider>();
        services.AddSingleton<IMindmapLayoutProvider, FreeLayoutProvider>();
        services.AddSingleton<IMindmapLayoutService, MindmapLayoutService>();

        // Styling: the cascade resolver and the template registry (built-ins plus the user's saved templates).
        services.AddSingleton<IMindmapStyleResolver, MindmapStyleResolver>();
        services.AddSingleton<IMindmapStyleTemplateProvider, MindmapStyleTemplateProvider>();
    }

    public void RegisterTranslationSources(ITranslationSourceRegistry registry)
    {
        var assembly = typeof(MindmapBackendModule).Assembly;
        registry.Add(new EmbeddedJsonTranslationSource(assembly, "Mnemo.Infrastructure.Modules.Mindmap.Translations"));
    }

    public void RegisterRoutes(INavigationRegistry registry)
    {
    }

    public void RegisterSidebarItems(ISidebarService sidebarService)
    {
        sidebarService.RegisterItem("Mindmap", "mindmap", "avares://Mnemo.UI/Icons/Sidebar/mindmap.svg", "Modules", 1, 50, childRoutes: ["mindmap-detail"]);
    }

    public void RegisterTools(IFunctionRegistry registry, IServiceProvider services)
    {
        var toolService = services.GetRequiredService<MindmapToolService>();
        MindmapToolRegistrar.Register(registry, toolService);
    }

    public void RegisterWidgets(IWidgetRegistry registry, IServiceProvider services)
    {
    }

    public void RegisterKeybindManifest(IKeybindManifestRegistry registry)
    {
        foreach (var def in MindmapKeybindManifest.Definitions)
            registry.Register(def);
    }
}

/// <summary>Canvas shortcuts for <c>mindmap-detail</c> (namespace <c>mindmap</c>).</summary>
internal static class MindmapKeybindManifest
{
    public const string Namespace = "mindmap";

    public static readonly KeybindActionDefinition[] Definitions =
    [
        Chords("mindmap.recenter", "Primary+D0", "Primary+NumPad0"),
        Chords("mindmap.zoom-in", "Primary+OemPlus", "Primary+Add"),
        Chords("mindmap.zoom-out", "Primary+OemMinus", "Primary+Subtract"),
        Chords("mindmap.undo", "Primary+Z"),
        Chords("mindmap.redo", "Primary+Y", "Primary+Shift+Z"),
        Chords("mindmap.clear-selection", "Escape"),
        Chords("mindmap.delete-selection", "Delete", "Back"),
        Chords("mindmap.select-all", "Primary+A"),
        Chords("mindmap.copy", "Primary+C"),
        Chords("mindmap.cut", "Primary+X"),
        Chords("mindmap.paste", "Primary+V"),
        Chords("mindmap.duplicate", "Primary+D"),
        Chords("mindmap.add-child", "Tab"),
        Chords("mindmap.enter", "Return", "Enter"),
        // The reverse of add-child: takes a node out from under its parent and drops it in next to
        // it. Only reaches nodes that have a grandparent to land under; a depth-one node has no move
        // to make here since the move op cannot express "become a new root".
        Chords("mindmap.outdent", "Shift+Tab"),
        Chords("mindmap.edit-edge-label", "F2"),
        Chords("mindmap.tool-select", "V"),
        Chords("mindmap.tool-pan", "H"),
        Chords("mindmap.connect", "C"),
        Chords("mindmap.new-node", "N"),
        Chords("mindmap.new-text", "T"),
        Chords("mindmap.new-frame", "F"),
        Chords("mindmap.shape-picker", "S"),
        // Not a tool the way its neighbours are: it opens a file picker, since a picture has to be
        // chosen before there is anything to place.
        Chords("mindmap.new-image", "I"),
        // A bare letter because the ring is held open rather than toggled, and a chord is not
        // something a hand can hold down while the other one flicks the pointer at a sector.
        Chords("mindmap.radial", "Q"),
    ];

    private static KeybindActionDefinition Chords(string actionId, params string[] gestures) =>
        new()
        {
            ActionId = actionId,
            Namespace = Namespace,
            Scope = KeybindScope.Local,
            Enabled = true,
            Module = "mindmap",
            DisplayLabelKey = actionId,
            DisplayCategoryKey = "category.mindmap",
            Bindings = gestures
                .Select(g => new KeybindBindingEntry
                {
                    Kind = KeybindBindingKind.Chord,
                    Chord = CanonicalKeyGestureCodec.ParseChord(g),
                })
                .ToArray(),
        };
}
