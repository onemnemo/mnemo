using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services;
using Mnemo.UI.Modules.Overview.ViewModels;

namespace Mnemo.UI.Modules.Overview;

public class OverviewModule : IModule
{
    public void ConfigureServices(IServiceRegistrar services)
    {
        services.AddTransient<OverviewViewModel>();
    }

    public void RegisterTranslationSources(ITranslationSourceRegistry registry)
    {
        var assembly = typeof(OverviewModule).Assembly;
        registry.Add(new EmbeddedJsonTranslationSource(assembly, "Mnemo.UI.Modules.Overview.Widgets.FlashcardStats.Translations"));
        registry.Add(new EmbeddedJsonTranslationSource(assembly, "Mnemo.UI.Modules.Overview.Widgets.RecentDecks.Translations"));
        registry.Add(new EmbeddedJsonTranslationSource(assembly, "Mnemo.UI.Modules.Overview.Widgets.StudyGoals.Translations"));
        registry.Add(new EmbeddedJsonTranslationSource(assembly, "Mnemo.UI.Modules.Overview.Widgets.RecentNotes.Translations"));
        registry.Add(new EmbeddedJsonTranslationSource(assembly, "Mnemo.UI.Modules.Overview.Widgets.UsageSummary.Translations"));
    }

    public void RegisterRoutes(INavigationRegistry registry)
    {
        registry.RegisterRoute("overview", typeof(OverviewViewModel));
    }

    public void RegisterSidebarItems(ISidebarService sidebarService)
    {
        sidebarService.RegisterItem("Overview", "overview", "avares://Mnemo.UI/Icons/Sidebar/overview.svg", "MainHub", 0, 0);
    }

    public void RegisterTools(IFunctionRegistry registry, IServiceProvider services)
    {
        // No tools for overview yet
    }

    public void RegisterWidgets(IWidgetRegistry registry, IServiceProvider services)
    {
        // Descriptors are stateless; widgets receive their services through IWidgetContext at creation time.
        registry.Register(new Widgets.FlashcardStats.FlashcardStatsWidgetDescriptor());
        registry.Register(new Widgets.RecentDecks.RecentDecksWidgetDescriptor());
        registry.Register(new Widgets.RecentNotes.RecentNotesWidgetDescriptor());
        registry.Register(new Widgets.StudyGoals.StudyGoalsWidgetDescriptor());
        registry.Register(new Widgets.UsageSummary.UsageSummaryWidgetDescriptor());
    }
}
