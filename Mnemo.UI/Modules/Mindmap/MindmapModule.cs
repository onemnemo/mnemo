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
using Mnemo.UI.Modules.Mindmap.ViewModels;

namespace Mnemo.UI.Modules.Mindmap;

/// <summary>
/// Schema v2 mindmap module: registers the document store/service, the library overview and the canvas
/// editor, routes, sidebar entry and canvas keybinds. (AI tools and the <c>.mnemo</c> handler are
/// not wired here yet.)
/// </summary>
public class MindmapModule : IModule
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

        services.AddTransient<MindmapOverviewViewModel>();
        services.AddTransient<MindmapViewModel>();
    }

    public void RegisterTranslationSources(ITranslationSourceRegistry registry)
    {
        var assembly = typeof(MindmapModule).Assembly;
        registry.Add(new EmbeddedJsonTranslationSource(assembly, "Mnemo.UI.Modules.Mindmap.Translations"));
    }

    public void RegisterRoutes(INavigationRegistry registry)
    {
        registry.RegisterRoute("mindmap", typeof(MindmapOverviewViewModel));
        registry.RegisterRoute("mindmap-detail", typeof(MindmapViewModel));
    }

    public void RegisterSidebarItems(ISidebarService sidebarService)
    {
        sidebarService.RegisterItem("Mindmap", "mindmap", "avares://Mnemo.UI/Icons/Sidebar/mindmap.svg", "Modules", 1, int.MaxValue, childRoutes: ["mindmap-detail"]);
    }

    public void RegisterTools(IFunctionRegistry registry, IServiceProvider services)
    {
        // Mindmap AI tools are reintroduced on the v2 command layer in P6.
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
        Chords("mindmap.undo", "Primary+Z"),
        Chords("mindmap.redo", "Primary+Y"),
        Chords("mindmap.clear-selection", "Escape"),
        Chords("mindmap.delete-selection", "Delete", "Back"),
        Chords("mindmap.copy", "Primary+C"),
        Chords("mindmap.paste", "Primary+V"),
        Chords("mindmap.duplicate", "Primary+D"),
        Chords("mindmap.add-child", "Tab"),
        Chords("mindmap.enter", "Return", "Enter"),
        Chords("mindmap.edit-edge-label", "F2"),
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
