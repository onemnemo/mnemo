using Mnemo.Core.Models.Widgets;
using Mnemo.Infrastructure.Services.Widgets;

namespace Mnemo.Infrastructure.Tests.Widgets;

public class OverviewLayoutStoreTests
{
    private const string LayoutKey = "overview_layout_v2";
    private const string LegacyKey = "overview_dashboard_layout";

    private readonly InMemoryStorageProvider _storage = new();
    private readonly WidgetRegistry _registry = new();
    private readonly OverviewLayoutStore _store;

    public OverviewLayoutStoreTests()
    {
        _registry.Register(TestWidgetDescriptor.Create(
            "mnemo.flashcard-stats",
            defaultSize: new WidgetSize(2, 1),
            supportedSizes: [new WidgetSize(2, 1), new WidgetSize(4, 1), new WidgetSize(1, 2)]));

        _registry.Register(TestWidgetDescriptor.Create(
            "mnemo.recent-decks",
            defaultSize: new WidgetSize(2, 2),
            supportedSizes: [new WidgetSize(2, 1), new WidgetSize(2, 2)]));

        _registry.Register(TestWidgetDescriptor.Create(
            "mnemo.recent-notes",
            defaultSize: new WidgetSize(2, 2),
            supportedSizes: [new WidgetSize(2, 1), new WidgetSize(2, 2)],
            settings:
            [
                new WidgetSettingSchema { Key = "days_to_show", LabelKey = "L", Type = WidgetSettingType.Range, DefaultValue = "7", Minimum = 1, Maximum = 90 },
                new WidgetSettingSchema { Key = "limit", LabelKey = "L", Type = WidgetSettingType.Range, DefaultValue = "5", Minimum = 1, Maximum = 10 }
            ]));

        _store = new OverviewLayoutStore(_storage, _registry, new TestLogger());
    }

    [Fact]
    public async Task Load_NothingStored_ReturnsSuccessWithNull()
    {
        var result = await _store.LoadAsync();

        Assert.True(result.IsSuccess);
        Assert.Null(result.Value);
    }

    [Fact]
    public async Task SaveThenLoad_RoundTripsWidgetsSettingsAndSchemaVersion()
    {
        var instanceId = Guid.NewGuid();
        var layout = new OverviewLayout
        {
            Widgets =
            [
                new WidgetInstance
                {
                    InstanceId = instanceId,
                    WidgetId = "mnemo.recent-notes",
                    Size = new WidgetSize(2, 2),
                    Order = 0,
                    Settings = new Dictionary<string, string>(StringComparer.Ordinal)
                    {
                        ["days_to_show"] = "14",
                        ["limit"] = "3"
                    }
                },
                new WidgetInstance
                {
                    WidgetId = "mnemo.flashcard-stats",
                    Size = new WidgetSize(4, 1),
                    Order = 1
                }
            ]
        };

        var saved = await _store.SaveAsync(layout);
        Assert.True(saved.IsSuccess);

        var loaded = await _store.LoadAsync();
        Assert.True(loaded.IsSuccess);
        var roundTripped = Assert.IsType<OverviewLayout>(loaded.Value);

        Assert.Equal(OverviewLayout.CurrentSchemaVersion, roundTripped.SchemaVersion);
        Assert.Equal(2, roundTripped.Widgets.Count);

        var notes = roundTripped.Widgets[0];
        Assert.Equal(instanceId, notes.InstanceId);
        Assert.Equal("mnemo.recent-notes", notes.WidgetId);
        Assert.Equal(new WidgetSize(2, 2), notes.Size);
        Assert.Equal(0, notes.Order);
        Assert.Equal("14", notes.Settings["days_to_show"]);
        Assert.Equal("3", notes.Settings["limit"]);

        var stats = roundTripped.Widgets[1];
        Assert.Equal("mnemo.flashcard-stats", stats.WidgetId);
        Assert.Equal(new WidgetSize(4, 1), stats.Size);
        Assert.Equal(1, stats.Order);
    }

    [Fact]
    public async Task SaveThenLoad_EmptyBoard_IsPreservedNotReplacedWithNull()
    {
        await _store.SaveAsync(new OverviewLayout());

        var loaded = await _store.LoadAsync();

        Assert.True(loaded.IsSuccess);
        Assert.NotNull(loaded.Value);
        Assert.Empty(loaded.Value!.Widgets);
    }

    [Fact]
    public async Task Load_SnapsUnsupportedSizesToNearestSupported()
    {
        var layout = new OverviewLayout
        {
            Widgets =
            [
                // 4×1 is not offered by mnemo.recent-decks; the nearest supported size is 2×1.
                new WidgetInstance { WidgetId = "mnemo.recent-decks", Size = new WidgetSize(4, 1) }
            ]
        };
        await _store.SaveAsync(layout);

        var loaded = await _store.LoadAsync();

        Assert.Equal(new WidgetSize(2, 1), loaded.Value!.Widgets[0].Size);
    }

    [Fact]
    public async Task Load_LegacyEntries_MigratesToV2()
    {
        // Row-major board order is stats (0,0) → decks (0,2) → notes (2,0), regardless of array order.
        _storage.Seed(LegacyKey,
            """
            [
                {"WidgetId":"recent-notes","Column":0,"Row":2,"ColSpan":3,"RowSpan":2},
                {"WidgetId":"flashcard-stats","Column":0,"Row":0,"ColSpan":2,"RowSpan":2},
                {"WidgetId":"recent-decks","Column":2,"Row":0,"ColSpan":3,"RowSpan":2}
            ]
            """);

        var result = await _store.LoadAsync();

        Assert.True(result.IsSuccess);
        var layout = Assert.IsType<OverviewLayout>(result.Value);
        Assert.Equal(OverviewLayout.CurrentSchemaVersion, layout.SchemaVersion);

        Assert.Equal(
            new[] { "mnemo.flashcard-stats", "mnemo.recent-decks", "mnemo.recent-notes" },
            layout.Widgets.Select(w => w.WidgetId).ToArray());
        Assert.Equal(new[] { 0, 1, 2 }, layout.Widgets.Select(w => w.Order).ToArray());

        // Fresh, unique instance identities.
        Assert.Equal(3, layout.Widgets.Select(w => w.InstanceId).Distinct().Count());
        Assert.All(layout.Widgets, w => Assert.NotEqual(Guid.Empty, w.InstanceId));

        // Legacy 12-column spans land on a supported v2 size.
        Assert.Equal(new WidgetSize(1, 2), layout.Widgets[0].Size);
        Assert.Equal(new WidgetSize(2, 2), layout.Widgets[1].Size);
        Assert.Equal(new WidgetSize(2, 2), layout.Widgets[2].Size);

        // Default settings are seeded from the manifest schema.
        var notes = layout.Widgets[2];
        Assert.Equal("7", notes.Settings["days_to_show"]);
        Assert.Equal("5", notes.Settings["limit"]);

        // The migrated layout is persisted under the v2 key; the legacy record stays untouched.
        Assert.True(_storage.Raw.ContainsKey(LayoutKey));
        Assert.True(_storage.Raw.ContainsKey(LegacyKey));
    }

    [Fact]
    public async Task Load_LegacyEntryWithUnknownWidget_IsKeptForPlaceholderRendering()
    {
        _storage.Seed(LegacyKey,
            """[{"WidgetId":"mystery-widget","Column":0,"Row":0,"ColSpan":6,"RowSpan":1}]""");

        var result = await _store.LoadAsync();

        var instance = Assert.Single(result.Value!.Widgets);
        Assert.Equal("mystery-widget", instance.WidgetId);
        Assert.Empty(instance.Settings);
        Assert.Equal(new WidgetSize(2, 1), instance.Size);
    }

    [Fact]
    public async Task Load_CorruptV2Payload_ReturnsFailureWithoutFallingBackToDefaults()
    {
        _storage.Seed(LayoutKey, "{ not json ]");

        var result = await _store.LoadAsync();

        Assert.False(result.IsSuccess);
    }
}
