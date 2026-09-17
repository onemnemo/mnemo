using Microsoft.Extensions.DependencyInjection;
using Mnemo.Core.Services.Search;
using Mnemo.Host.Composition;
using Mnemo.Infrastructure.Services;
using Mnemo.Infrastructure.Services.Search;

namespace Mnemo.Host.Tests.Search;

/// <summary>
/// <see cref="FlashcardsSearchProvider"/>, <see cref="DecksSearchProvider"/> and
/// <see cref="MindmapSearchProvider"/> are not registered by the Host directly. They come in through
/// their modules' <c>ConfigureServices</c>, replayed by the same module-discovery loop
/// <c>HostWidgetRegistryTests</c> exercises for widgets (the module loop in
/// <c>HostComposition.AddMnemoBackend</c>). A change to a module, or to which assemblies discovery scans, would silently drop
/// that group from every search result without any endpoint failing, since
/// <c>NavigationSearchProvider</c> alone is enough to keep <c>/api/search</c> returning 200s.
/// </summary>
public sealed class SearchProviderRegistrationTests
{
    [Fact]
    public void TheModuleReplayRegistersFlashcardsAndDecksSearchProviders()
    {
        var providerTypes = RegisteredProviderTypes();

        Assert.Contains(typeof(FlashcardsSearchProvider), providerTypes);
        Assert.Contains(typeof(DecksSearchProvider), providerTypes);
    }

    [Fact]
    public void TheModuleReplayRegistersTheMindmapSearchProvider()
    {
        Assert.Contains(typeof(MindmapSearchProvider), RegisteredProviderTypes());
    }

    private static List<Type?> RegisteredProviderTypes()
    {
        var modules = HostComposition.DiscoverModules(out var failures);
        Assert.Empty(failures);

        var services = new ServiceCollection();
        var registrar = new ServiceRegistrar(services);
        foreach (var module in modules)
            module.ConfigureServices(registrar);

        return services
            .Where(d => d.ServiceType == typeof(ISearchProvider))
            .Select(d => d.ImplementationType)
            .ToList();
    }
}
