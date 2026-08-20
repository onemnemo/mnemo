using System;
using Mnemo.Core.Services;
using Mnemo.UI.Components;
using Mnemo.UI.Components.Sidebar;
using Mnemo.UI.Services;
using Mnemo.UI.ViewModels;

namespace Mnemo.UI.Modules;

/// <summary>
/// The shell's own view models. The global chords and the application tools that used to sit
/// here are registered by <c>CoreBackendModule</c>, which runs in both shells.
/// </summary>
public class CoreUIModule : IModule
{
    public void ConfigureServices(IServiceRegistrar services)
    {
        services.AddSingleton<ChatPauseToSendEstimator>();
        services.AddTransient<MainWindowViewModel>();
        services.AddTransient<SidebarViewModel>();
        services.AddTransient<TopbarViewModel>();
        services.AddSingleton<ITopbarTrailService, TopbarTrailService>();
    }

    public void RegisterTranslationSources(ITranslationSourceRegistry registry)
    {
    }

    public void RegisterRoutes(INavigationRegistry registry)
    {
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
