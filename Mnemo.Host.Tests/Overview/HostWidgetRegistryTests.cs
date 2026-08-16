using Microsoft.Extensions.DependencyInjection;
using Mnemo.Host.Composition;
using Mnemo.Infrastructure.Services.Widgets;
using Xunit;

namespace Mnemo.Host.Tests.Overview;

/// <summary>
/// The host has to know the widget manifests, not just the stored board.
/// <para>
/// The overview endpoint made this process the first one that can trigger the board's legacy
/// v1 → v2 migration, and that migration reads each widget's manifest to seed its default
/// settings and snap the rescaled size, then writes the result back under the v2 key. It runs
/// once, ever. A host that migrated with an empty registry would hand the profile settingless,
/// unsnapped widgets permanently, because the desktop app afterwards finds a v2 board and has
/// nothing left to migrate.
/// </para>
/// </summary>
public sealed class HostWidgetRegistryTests
{
    /// <summary>
    /// The v2 ids the legacy migration can emit. v1 only ever stored these five, so these are
    /// exactly the manifests that have to be resolvable before the migration can run.
    /// </summary>
    private static readonly string[] MigratableWidgetIds =
    [
        "mnemo.flashcard-stats",
        "mnemo.recent-decks",
        "mnemo.recent-notes",
        "mnemo.study-goals",
        "mnemo.usage-summary"
    ];

    [Fact]
    public void TheStartupPassRegistersWidgets()
    {
        Assert.NotEmpty(RegisterAsStartupDoes().AvailableDescriptors);
    }

    [Fact]
    public void EveryWidgetTheMigrationCanEmitResolvesToAManifest()
    {
        var registry = RegisterAsStartupDoes();

        foreach (var widgetId in MigratableWidgetIds)
        {
            var descriptor = registry.GetDescriptor(widgetId);
            Assert.NotNull(descriptor);
            Assert.NotEmpty(descriptor.Manifest.SupportedSizes);
        }
    }

    [Fact]
    public void AConfigurableWidgetBringsTheDefaultSettingsTheMigrationSeeds()
    {
        // Without this the migrated instance keeps an empty settings bag and the widget renders
        // with whatever its code falls back to, forever.
        var manifest = RegisterAsStartupDoes().GetDescriptor("mnemo.recent-notes")!.Manifest;

        Assert.NotEmpty(manifest.Settings);
        var defaults = manifest.CreateDefaultSettings();
        Assert.Equal(manifest.Settings.Count, defaults.Count);
        Assert.All(manifest.Settings, schema => Assert.Equal(schema.DefaultValue, defaults[schema.Key]));
    }

    /// <summary>Builds a registry the way <c>InitializeBackendAsync</c> does.</summary>
    private static WidgetRegistry RegisterAsStartupDoes()
    {
        var registry = new WidgetRegistry();
        var modules = HostComposition.DiscoverModules(out var failures);

        Assert.Empty(failures);

        // The registrations the host replays ignore the provider; the descriptors are stateless
        // and take their services later, through IWidgetContext.
        using var services = new ServiceCollection().BuildServiceProvider();
        HostComposition.RegisterModuleWidgets(modules, registry, services);

        return registry;
    }
}
