using System.Reflection;
using Microsoft.Extensions.DependencyInjection;
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
        sidebarService.RegisterItem("Overview", "overview", "avares://Mnemo.UI/Icons/Sidebar/home.svg", "MainHub", 0, 0);
    }

    public void RegisterTools(IFunctionRegistry registry, IServiceProvider services)
    {
        // No tools for overview yet
    }

    public void RegisterWidgets(IWidgetRegistry registry, IServiceProvider services)
    {
        var stats = services.GetRequiredService<IStatisticsManager>();
        var decks = services.GetRequiredService<IFlashcardDeckService>();
        var notes = services.GetRequiredService<INoteService>();
        var navigation = services.GetRequiredService<INavigationService>();
        var logger = services.GetRequiredService<ILoggerService>();
        var localization = services.GetRequiredService<ILocalizationService>();
        var dateDisplay = services.GetRequiredService<IDateDisplayService>();

        registry.RegisterWidget(new Widgets.FlashcardStats.FlashcardStatsWidget(stats, logger));
        registry.RegisterWidget(new Widgets.RecentDecks.RecentDecksWidget(stats, decks, navigation, logger, localization, dateDisplay));
        registry.RegisterWidget(new Widgets.StudyGoals.StudyGoalsWidget(stats, logger, localization));
        registry.RegisterWidget(new Widgets.RecentNotes.RecentNotesWidget(notes, navigation, logger, localization, dateDisplay));
        registry.RegisterWidget(new Widgets.UsageSummary.UsageSummaryWidget(stats, logger, localization));
    }
}

