using System;
using Mnemo.Core.Services;
using Mnemo.UI.Modules.Settings.ViewModels;

namespace Mnemo.UI.Modules.Settings;

/// <summary>
/// The settings screen. Navigation, search and the settings tools are registered by
/// <c>SettingsBackendModule</c>, which runs in both shells.
/// </summary>
public class SettingsModule : IModule
{
    public void ConfigureServices(IServiceRegistrar services)
    {
        services.AddTransient<SettingsViewModel>();
    }

    public void RegisterTranslationSources(ITranslationSourceRegistry registry)
    {
    }

    public void RegisterRoutes(INavigationRegistry registry)
    {
        registry.RegisterRoute("settings", typeof(SettingsViewModel));
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
