using System;
using Mnemo.Core.Services;
using Mnemo.UI.Modules.Overview.ViewModels;

namespace Mnemo.UI.Modules.Overview;

/// <summary>
/// The overview board screen and the factory that draws its widgets. The widget manifests,
/// their translations and the navigation entry are registered by <c>OverviewBackendModule</c>,
/// which runs in both shells.
/// </summary>
public class OverviewModule : IModule
{
    public void ConfigureServices(IServiceRegistrar services)
    {
        services.AddTransient<OverviewViewModel>();
        services.AddSingleton<IWidgetViewModelFactory, OverviewWidgetViewModelFactory>();
    }

    public void RegisterTranslationSources(ITranslationSourceRegistry registry)
    {
    }

    public void RegisterRoutes(INavigationRegistry registry)
    {
        registry.RegisterRoute("overview", typeof(OverviewViewModel));
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
