using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.UI.Modules.Path.ViewModels;

namespace Mnemo.UI.Modules.Path;

public class PathModule : IModule
{
    public void ConfigureServices(IServiceRegistrar services)
    {
        services.AddTransient<PathViewModel>();
        services.AddTransient<PathDetailViewModel>();
    }

    public void RegisterTranslationSources(ITranslationSourceRegistry registry)
    {
        // No module translations yet
    }

    public void RegisterRoutes(INavigationRegistry registry)
    {
        registry.RegisterRoute("path", typeof(PathViewModel));
        registry.RegisterRoute("path-detail", typeof(PathDetailViewModel));
    }

    public void RegisterSidebarItems(ISidebarService sidebarService)
    {
        sidebarService.RegisterItem("LearningPath", "path", "avares://Mnemo.UI/Icons/Sidebar/route-square.svg", "MainHub", 0, 1, visibilityRequirement: SidebarItemVisibilityRequirement.AiAssistantEnabled, childRoutes: ["path-detail"]);
    }

    public void RegisterTools(IFunctionRegistry registry, IServiceProvider services)
    {
        // No tools for path yet
    }

    public void RegisterWidgets(IWidgetRegistry registry, IServiceProvider services)
    {
        // No widgets for path
    }
}

