using System;
using Mnemo.Core.Services;
using Mnemo.UI.Modules.Mindmap.ViewModels;

namespace Mnemo.UI.Modules.Mindmap;

/// <summary>
/// The mindmap library overview and the canvas editor. The document store and service, the
/// layout and style engines, the translations, navigation, tools and canvas chords are
/// registered by <c>MindmapBackendModule</c>, which runs in both shells.
/// </summary>
public class MindmapModule : IModule
{
    public void ConfigureServices(IServiceRegistrar services)
    {
        services.AddTransient<MindmapOverviewViewModel>();
        services.AddTransient<MindmapViewModel>();
    }

    public void RegisterTranslationSources(ITranslationSourceRegistry registry)
    {
    }

    public void RegisterRoutes(INavigationRegistry registry)
    {
        registry.RegisterRoute("mindmap", typeof(MindmapOverviewViewModel));
        registry.RegisterRoute("mindmap-detail", typeof(MindmapViewModel));
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
