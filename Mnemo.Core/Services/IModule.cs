using System;

namespace Mnemo.Core.Services;

/// <summary>
/// Defines a module that can register services, widgets, and AI tools.
/// </summary>
public interface IModule
{
    void ConfigureServices(IServiceRegistrar services);
    /// <summary>
    /// Registers translation sources for this module. Called before the service provider is built.
    /// </summary>
    void RegisterTranslationSources(ITranslationSourceRegistry registry);
    void RegisterSidebarItems(ISidebarService sidebarService);
    /// <summary>
    /// Registers AI tools. <paramref name="services"/> provides access to resolved services
    /// (e.g. INoteService) needed to implement tool handlers.
    /// </summary>
    void RegisterTools(IFunctionRegistry registry, IServiceProvider services);

    /// <summary>
    /// Registers dashboard widgets. <paramref name="services"/> provides access to resolved services
    /// (e.g. <see cref="IStatisticsManager"/>) so widget factories can wire data dependencies.
    /// </summary>
    void RegisterWidgets(IWidgetRegistry registry, IServiceProvider services);

    /// <summary>
    /// Registers static keybind manifest entries. Called during bootstrap before the service provider is built.
    /// </summary>
    void RegisterKeybindManifest(IKeybindManifestRegistry registry) { }
}

