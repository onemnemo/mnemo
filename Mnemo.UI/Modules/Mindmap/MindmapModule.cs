using System;
using System.Linq;
using Mnemo.Core.History;
using Mnemo.Core.Models.Keybinds;
using Mnemo.Core.Services;
using Mnemo.Core.Services.Keybinds;
using Mnemo.Core.Services.Search;
using Microsoft.Extensions.DependencyInjection;
using Mnemo.Infrastructure.Services;
using Mnemo.Infrastructure.Services.Search;
using Mnemo.Infrastructure.Services.Tools;
using Mnemo.UI.Modules.Mindmap.Services;
using Mnemo.UI.Modules.Mindmap.ViewModels;

namespace Mnemo.UI.Modules.Mindmap;

public class MindmapModule : IModule
{
    public void ConfigureServices(IServiceRegistrar services)
    {
        services.AddSingleton<IMindmapService, MindmapService>();
        services.AddSingleton<IMindmapLayoutService, MindmapLayoutService>();
        // Each MindmapViewModel gets its own graph state. The session, history,
        // clipboard, hover, and mutator must all share the SAME session/history
        // instances so mutations operate on the data the VM is displaying.
        // AddTransient auto-resolution would give MindmapGraphMutator its own
        // fresh MindmapEditorSession (Current==null), breaking all edits.
        services.AddTransient<MindmapViewModel>(sp =>
        {
            var session = new MindmapEditorSession();
            var history = new MindmapEditorHistory(sp.GetRequiredService<IHistoryManager>());
            var clipboard = new MindmapClipboard();
            var hover = new MindmapEdgeHoverState(session);
            var mutator = new MindmapGraphMutator(
                sp.GetRequiredService<IMindmapService>(),
                sp.GetRequiredService<IMindmapLayoutService>(),
                session,
                history,
                clipboard,
                sp.GetService<ILoggerService>());
            return new MindmapViewModel(
                sp.GetRequiredService<IMindmapService>(),
                session,
                history,
                mutator,
                hover,
                sp.GetService<ISettingsService>(),
                sp.GetService<IOverlayService>(),
                sp.GetService<ILocalizationService>(),
                sp.GetService<ILoggerService>());
        });
        services.AddTransient<MindmapOverviewViewModel>();
        services.AddSingleton<ISearchProvider, MindmapsSearchProvider>();
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
        var svc = services.GetRequiredService<MindmapToolService>();
        MindmapToolRegistrar.Register(registry, svc);
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
        Chords("mindmap.enter", "Enter"),
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
