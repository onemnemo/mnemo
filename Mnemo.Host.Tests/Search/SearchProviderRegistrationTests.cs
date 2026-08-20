using Microsoft.Extensions.DependencyInjection;
using Mnemo.Core.Services.Search;
using Mnemo.Host.Composition;
using Mnemo.Infrastructure.Services;
using Mnemo.Infrastructure.Services.Search;

namespace Mnemo.Host.Tests.Search;

/// <summary>
/// <see cref="FlashcardsSearchProvider"/> and <see cref="DecksSearchProvider"/> are not
/// registered by the Host directly. They come in through <c>FlashcardsModule.ConfigureServices</c>,
/// replayed by the same module-discovery loop <c>HostWidgetRegistryTests</c> exercises for
/// widgets (see <c>HostComposition.AddMnemoBackend</c> section 3). A change to the module, or to
/// which assemblies discovery scans, would silently drop the flashcards and decks groups from
/// every search result without any endpoint failing, since <c>NavigationSearchProvider</c> alone
/// is enough to keep <c>/api/search</c> returning 200s.
/// </summary>
public sealed class SearchProviderRegistrationTests
{
    [Fact]
    public void TheModuleReplayRegistersFlashcardsAndDecksSearchProviders()
    {
        var modules = HostComposition.DiscoverModules(out var failures);
        Assert.Empty(failures);

        var services = new ServiceCollection();
        var registrar = new ServiceRegistrar(services);
        foreach (var module in modules)
            module.ConfigureServices(registrar);

        var providerTypes = services
            .Where(d => d.ServiceType == typeof(ISearchProvider))
            .Select(d => d.ImplementationType)
            .ToList();

        Assert.Contains(typeof(FlashcardsSearchProvider), providerTypes);
        Assert.Contains(typeof(DecksSearchProvider), providerTypes);
    }
}
