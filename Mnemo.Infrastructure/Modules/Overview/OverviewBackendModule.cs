using System;
using Microsoft.Extensions.DependencyInjection;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services;
using Mnemo.Infrastructure.Services.Widgets;

namespace Mnemo.Infrastructure.Modules.Overview;

/// <summary>
/// The overview board's widget manifests, their translations, and the module's place in the
/// navigation. The board screen is registered by the Avalonia half of this module.
/// </summary>
public sealed class OverviewBackendModule : IModule
{
    public void ConfigureServices(IServiceRegistrar services)
    {
    }

    public void RegisterTranslationSources(ITranslationSourceRegistry registry)
    {
        var assembly = typeof(OverviewBackendModule).Assembly;
        registry.Add(new EmbeddedJsonTranslationSource(assembly, "Mnemo.Infrastructure.Modules.Overview.Widgets.FlashcardStats.Translations"));
        registry.Add(new EmbeddedJsonTranslationSource(assembly, "Mnemo.Infrastructure.Modules.Overview.Widgets.FlashcardMemory.Translations"));
        registry.Add(new EmbeddedJsonTranslationSource(assembly, "Mnemo.Infrastructure.Modules.Overview.Widgets.FlashcardTests.Translations"));
        registry.Add(new EmbeddedJsonTranslationSource(assembly, "Mnemo.Infrastructure.Modules.Overview.Widgets.RecentDecks.Translations"));
        registry.Add(new EmbeddedJsonTranslationSource(assembly, "Mnemo.Infrastructure.Modules.Overview.Widgets.StudyGoals.Translations"));
        registry.Add(new EmbeddedJsonTranslationSource(assembly, "Mnemo.Infrastructure.Modules.Overview.Widgets.RecentNotes.Translations"));
        registry.Add(new EmbeddedJsonTranslationSource(assembly, "Mnemo.Infrastructure.Modules.Overview.Widgets.UsageSummary.Translations"));
    }

    public void RegisterSidebarItems(ISidebarService sidebarService)
    {
        sidebarService.RegisterItem("Overview", "overview", "avares://Mnemo.UI/Icons/Sidebar/overview.svg", "MainHub", 0, 0);
    }

    public void RegisterTools(IFunctionRegistry registry, IServiceProvider services)
    {
    }

    public void RegisterWidgets(IWidgetRegistry registry, IServiceProvider services)
    {
        // Descriptors are stateless; widgets receive their services through IWidgetContext at creation time.
        // A shell that renders the board registers the factory below, and one that only serves
        // the manifests over HTTP does not, so this asks rather than requires.
        var viewModels = services.GetService<IWidgetViewModelFactory>();
        foreach (var manifest in OverviewWidgetManifests.All)
            registry.Register(new BuiltInWidgetDescriptor(manifest, viewModels));
    }
}
