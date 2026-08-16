using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.UI.Modules.Chat.ViewModels;

namespace Mnemo.UI.Modules.Chat;

public class ChatModule : IModule
{
    public void ConfigureServices(IServiceRegistrar services)
    {
        services.AddTransient<ChatViewModel>();
    }

    public void RegisterTranslationSources(ITranslationSourceRegistry registry)
    {
        // No module translations yet
    }

    public void RegisterRoutes(INavigationRegistry registry)
    {
        registry.RegisterRoute("soma", typeof(ChatViewModel));
    }

    public void RegisterSidebarItems(ISidebarService sidebarService)
    {
        // Soma sits beside Overview rather than down in the ecosystem group: it is
        // something you work with, not somewhere you go to configure the app. Still
        // gated on the assistant toggle, which hides it outright when off.
        sidebarService.RegisterItem("Soma", "soma", "avares://Mnemo.UI/Icons/Sidebar/sparkles.svg", "MainHub", 0, 10, visibilityRequirement: SidebarItemVisibilityRequirement.AiAssistantEnabled);
    }

    public void RegisterTools(IFunctionRegistry registry, IServiceProvider services)
    {
        // No tools for chat yet
    }

    public void RegisterWidgets(IWidgetRegistry registry, IServiceProvider services)
    {
        // No widgets for chat
    }
}

