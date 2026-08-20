using System;
using Mnemo.Core.Services;
using Mnemo.Core.Services.Search;
using Microsoft.Extensions.DependencyInjection;
using Mnemo.Infrastructure.Services.Search;
using Mnemo.Infrastructure.Services.Tools;

namespace Mnemo.Infrastructure.Modules.Settings;

/// <summary>
/// The settings module's place in the navigation, its search provider, and the tools that let
/// the assistant read and change a setting. The settings screen is registered by the Avalonia
/// half of this module.
/// </summary>
public sealed class SettingsBackendModule : IModule
{
    public void ConfigureServices(IServiceRegistrar services)
    {
        services.AddSingleton<ISearchProvider, SettingsSearchProvider>();
    }

    public void RegisterTranslationSources(ITranslationSourceRegistry registry)
    {
    }

    public void RegisterRoutes(INavigationRegistry registry)
    {
    }

    public void RegisterSidebarItems(ISidebarService sidebarService)
    {
        sidebarService.RegisterItem("Settings", "settings", "avares://Mnemo.UI/Icons/Sidebar/settings.svg", "Ecosystem", 2, int.MaxValue);
    }

    public void RegisterTools(IFunctionRegistry registry, IServiceProvider services)
    {
        var svc = services.GetRequiredService<SettingsToolService>();
        SettingsToolRegistrar.Register(registry, svc);
    }

    public void RegisterWidgets(IWidgetRegistry registry, IServiceProvider services)
    {
    }
}
