using Mnemo.Core.Services;
using Mnemo.UI.Modules.Onboarding.ViewModels;

namespace Mnemo.UI.Modules.Onboarding;

public class OnboardingModule : IModule
{
    public void ConfigureServices(IServiceRegistrar services)
    {
        services.AddTransient<OnboardingWizardViewModel>();
    }

    public void RegisterTranslationSources(ITranslationSourceRegistry registry)
    {
        // No module translations yet; can add EmbeddedJsonTranslationSource for Translations/ later
    }

    public void RegisterRoutes(INavigationRegistry registry)
    {
        // Onboarding is shown as overlay, not a route
    }

    public void RegisterSidebarItems(ISidebarService sidebarService)
    {
        // No sidebar entry for onboarding
    }

    public void RegisterTools(IFunctionRegistry registry, IServiceProvider services)
    {
        // No tools
    }

    public void RegisterWidgets(IWidgetRegistry registry, IServiceProvider services)
    {
        // No widgets
    }
}
