using System;
using Mnemo.Core.Models;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Modules.Chat;

/// <summary>
/// The assistant's place in the navigation. Its screen and view model are registered by the
/// Avalonia half of this module.
/// </summary>
public sealed class ChatBackendModule : IModule
{
    public void ConfigureServices(IServiceRegistrar services)
    {
    }

    public void RegisterTranslationSources(ITranslationSourceRegistry registry)
    {
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
    }

    public void RegisterWidgets(IWidgetRegistry registry, IServiceProvider services)
    {
    }
}
