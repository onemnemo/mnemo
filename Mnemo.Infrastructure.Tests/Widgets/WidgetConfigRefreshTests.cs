using Mnemo.Core.Models;
using Mnemo.Core.Models.Widgets;
using Mnemo.Core.Services;
using Mnemo.UI.Modules.Overview.Widgets.RecentNotes;

namespace Mnemo.Infrastructure.Tests.Widgets;

/// <summary>
/// Verifies the schema-driven config contract on a real widget: values fall back to schema
/// defaults, <see cref="IWidgetConfigurable.SetConfigAsync"/> re-queries the data, and the
/// new settings are observable through <see cref="IWidgetConfigurable.GetConfigAsync"/>.
/// </summary>
public class WidgetConfigRefreshTests
{
    private static readonly WidgetManifest Manifest = new RecentNotesWidgetDescriptor().Manifest;

    private static Note MakeNote(string id, DateTime createdUtc, DateTime modifiedUtc) => new()
    {
        NoteId = id,
        Title = id,
        CreatedAt = createdUtc,
        ModifiedAt = modifiedUtc
    };

    private static RecentNotesWidgetViewModel CreateViewModel(FakeWidgetContext context, Dictionary<string, string>? settings = null)
    {
        var instance = new WidgetInstance
        {
            WidgetId = Manifest.WidgetId,
            Size = Manifest.DefaultSize,
            Settings = settings ?? Manifest.CreateDefaultSettings()
        };
        return new RecentNotesWidgetViewModel(Manifest, instance, context);
    }

    [Fact]
    public async Task Initialize_WithDefaults_AppliesLimitAndWindow()
    {
        var context = new FakeWidgetContext();
        var now = DateTime.UtcNow;
        for (var i = 0; i < 8; i++)
            context.NoteService.NotesToReturn.Add(MakeNote($"n{i}", now.AddDays(-i), now.AddDays(-i)));
        // Outside the default 7-day window; must be filtered out.
        context.NoteService.NotesToReturn.Add(MakeNote("stale", now.AddDays(-30), now.AddDays(-30)));

        var viewModel = CreateViewModel(context);
        await viewModel.InitializeAsync();

        Assert.Equal(5, viewModel.Items.Count); // default limit
        Assert.DoesNotContain(viewModel.Items, r => r.NoteId == "stale");
        Assert.False(viewModel.IsEmpty);
    }

    [Fact]
    public async Task SetConfig_Limit_RefreshesRowsImmediately()
    {
        var context = new FakeWidgetContext();
        var now = DateTime.UtcNow;
        for (var i = 0; i < 6; i++)
            context.NoteService.NotesToReturn.Add(MakeNote($"n{i}", now.AddHours(-i), now.AddHours(-i)));

        var viewModel = CreateViewModel(context);
        await viewModel.InitializeAsync();
        Assert.Equal(5, viewModel.Items.Count);

        IWidgetConfigurable configurable = viewModel;
        await configurable.SetConfigAsync(new Dictionary<string, string> { ["limit"] = "2" });

        Assert.Equal(2, viewModel.Items.Count);
        var config = await configurable.GetConfigAsync();
        Assert.Equal("2", config["limit"]);
    }

    [Fact]
    public async Task SetConfig_SortBy_SwitchesBetweenCreatedAndModified()
    {
        var context = new FakeWidgetContext();
        var now = DateTime.UtcNow;
        // "old-created" was created first but edited last; "new-created" is the reverse.
        context.NoteService.NotesToReturn.Add(MakeNote("old-created", now.AddDays(-3), now.AddHours(-1)));
        context.NoteService.NotesToReturn.Add(MakeNote("new-created", now.AddHours(-2), now.AddDays(-2)));

        var viewModel = CreateViewModel(context);
        await viewModel.InitializeAsync();
        // Default sort_by=date orders by creation date.
        Assert.Equal("new-created", viewModel.Items[0].NoteId);

        IWidgetConfigurable configurable = viewModel;
        await configurable.SetConfigAsync(new Dictionary<string, string> { ["sort_by"] = "modified" });

        Assert.Equal("old-created", viewModel.Items[0].NoteId);
    }

    [Fact]
    public async Task SetConfig_WindowExcludesEverything_ShowsEmptyState()
    {
        var context = new FakeWidgetContext();
        var stale = DateTime.UtcNow.AddDays(-20);
        context.NoteService.NotesToReturn.Add(MakeNote("stale", stale, stale));

        var viewModel = CreateViewModel(context);
        await viewModel.InitializeAsync();
        Assert.True(viewModel.IsEmpty);

        IWidgetConfigurable configurable = viewModel;
        await configurable.SetConfigAsync(new Dictionary<string, string> { ["days_to_show"] = "30" });

        Assert.False(viewModel.IsEmpty);
        Assert.Single(viewModel.Items);
    }

    [Fact]
    public async Task GetConfig_MissingValues_FallBackToSchemaDefaults()
    {
        var viewModel = CreateViewModel(new FakeWidgetContext(), settings: new Dictionary<string, string>(StringComparer.Ordinal));

        IWidgetConfigurable configurable = viewModel;
        var config = await configurable.GetConfigAsync();

        Assert.Equal("7", config["days_to_show"]);
        Assert.Equal("date", config["sort_by"]);
        Assert.Equal("5", config["limit"]);
    }
}
