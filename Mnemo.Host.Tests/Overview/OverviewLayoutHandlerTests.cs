using Mnemo.Core.Models;
using Mnemo.Core.Models.Widgets;
using Mnemo.Core.Services;
using Mnemo.Host.Contracts;
using Mnemo.Host.Overview;
using Xunit;

namespace Mnemo.Host.Tests.Overview;

/// <summary>
/// The load half of these tests is the point of the file: a stored board, a profile that never
/// saved one, and a read that failed have to stay three answers. Fold the failure into the
/// never-saved answer and the client seeds a starter board over a board that is still on disk.
/// </summary>
public sealed class OverviewLayoutHandlerTests
{
    private readonly FakeLayoutStore _store = new();

    [Fact]
    public async Task LoadReturnsTheStoredBoard()
    {
        var widget = StoredWidget("mnemo.recent-notes", column: 2, row: 1);
        _store.LoadResult = Result<OverviewLayout?>.Success(Board(widget));

        var loaded = await OverviewLayoutHandler.LoadAsync(_store, CancellationToken.None);

        Assert.Equal(OverviewLayoutLoadStatus.Loaded, loaded.Status);
        Assert.Equal(OverviewLayout.CurrentSchemaVersion, loaded.Layout!.SchemaVersion);
        Assert.Equal(OverviewLayout.DefaultProfileId, loaded.Layout.ProfileId);

        var dto = Assert.Single(loaded.Layout.Widgets);
        Assert.Equal(widget.InstanceId, dto.InstanceId);
        Assert.Equal("mnemo.recent-notes", dto.WidgetId);
        Assert.Equal(2, dto.Size.Columns);
        Assert.Equal(1, dto.Size.Rows);
        Assert.Equal(2, dto.Column);
        Assert.Equal(1, dto.Row);
        Assert.Equal(3, dto.Order);
        Assert.Equal("week", dto.Settings["range"]);
    }

    [Fact]
    public async Task LoadOfAProfileThatNeverSavedIsNeverSaved()
    {
        _store.LoadResult = Result<OverviewLayout?>.Success(null);

        var loaded = await OverviewLayoutHandler.LoadAsync(_store, CancellationToken.None);

        Assert.Equal(OverviewLayoutLoadStatus.NeverSaved, loaded.Status);
        Assert.Null(loaded.Layout);
        Assert.Null(loaded.ErrorMessage);
    }

    [Fact]
    public async Task LoadFailureIsNotReportedAsNeverSaved()
    {
        // A corrupt payload is the real case: the row is there and readable next launch, but this
        // read cannot make sense of it. Answering "nothing saved" invites the client to replace it.
        _store.LoadResult = Result<OverviewLayout?>.Failure("Corrupt overview layout payload.");

        var loaded = await OverviewLayoutHandler.LoadAsync(_store, CancellationToken.None);

        Assert.Equal(OverviewLayoutLoadStatus.Failed, loaded.Status);
        Assert.NotEqual(OverviewLayoutLoadStatus.NeverSaved, loaded.Status);
        Assert.Null(loaded.Layout);
        Assert.Equal("Corrupt overview layout payload.", loaded.ErrorMessage);
    }

    [Fact]
    public async Task ADeliberatelyClearedBoardLoadsAsAnEmptyBoardNotAsNeverSaved()
    {
        _store.LoadResult = Result<OverviewLayout?>.Success(Board());

        var loaded = await OverviewLayoutHandler.LoadAsync(_store, CancellationToken.None);

        Assert.Equal(OverviewLayoutLoadStatus.Loaded, loaded.Status);
        Assert.Empty(loaded.Layout!.Widgets);
    }

    [Fact]
    public async Task SaveHandsTheStoreEveryFieldTheBodyCarried()
    {
        var instanceId = Guid.NewGuid();
        var body = BoardDto(new WidgetInstanceDto(
            instanceId,
            "mnemo.study-goals",
            new WidgetSizeDto(1, 2),
            Column: 3,
            Row: 0,
            Order: 7,
            Settings: new Dictionary<string, string> { ["goal"] = "20" }));

        var saved = await OverviewLayoutHandler.SaveAsync(_store, body, CancellationToken.None);

        Assert.Equal(OverviewLayoutSaveStatus.Saved, saved.Status);
        var stored = Assert.Single(_store.Saved!.Widgets);
        Assert.Equal(instanceId, stored.InstanceId);
        Assert.Equal("mnemo.study-goals", stored.WidgetId);
        Assert.Equal(new WidgetSize(1, 2), stored.Size);
        Assert.Equal(3, stored.Column);
        Assert.Equal(0, stored.Row);
        Assert.Equal(7, stored.Order);
        Assert.Equal("20", stored.Settings["goal"]);
        Assert.Equal(OverviewLayout.DefaultProfileId, _store.Saved.ProfileId);
    }

    [Fact]
    public async Task ABoardSurvivesASaveFollowedByALoad()
    {
        var body = BoardDto(
            new WidgetInstanceDto(Guid.NewGuid(), "mnemo.recent-decks", new WidgetSizeDto(2, 1), 0, 0, 0,
                new Dictionary<string, string>()),
            new WidgetInstanceDto(Guid.NewGuid(), "mnemo.usage-summary", new WidgetSizeDto(1, 1), -1, -1, 1,
                new Dictionary<string, string> { ["window"] = "30d" }));

        await OverviewLayoutHandler.SaveAsync(_store, body, CancellationToken.None);
        _store.LoadResult = Result<OverviewLayout?>.Success(_store.Saved);

        var loaded = await OverviewLayoutHandler.LoadAsync(_store, CancellationToken.None);

        Assert.Equal(OverviewLayoutLoadStatus.Loaded, loaded.Status);
        Assert.Equal(
            body.Widgets.Select(w => (w.InstanceId, w.WidgetId, w.Size.Columns, w.Size.Rows, w.Column, w.Row, w.Order)),
            loaded.Layout!.Widgets.Select(w => (w.InstanceId, w.WidgetId, w.Size.Columns, w.Size.Rows, w.Column, w.Row, w.Order)));
        Assert.Equal("30d", loaded.Layout.Widgets[1].Settings["window"]);
    }

    [Fact]
    public async Task UnplacedCoordinatesAreStoredAsSentNotRejected()
    {
        // -1 means "put it wherever fits"; it is what a freshly added widget carries until the
        // layout engine places it, so it has to reach the store intact.
        var body = BoardDto(new WidgetInstanceDto(Guid.NewGuid(), "mnemo.flashcard-stats",
            new WidgetSizeDto(2, 2), -1, -1, 0, new Dictionary<string, string>()));

        var saved = await OverviewLayoutHandler.SaveAsync(_store, body, CancellationToken.None);

        Assert.Equal(OverviewLayoutSaveStatus.Saved, saved.Status);
        var stored = Assert.Single(_store.Saved!.Widgets);
        Assert.Equal(-1, stored.Column);
        Assert.Equal(-1, stored.Row);
    }

    [Fact]
    public async Task ARowFarPastTheBoardIsMalformedRatherThanAnAllocation()
    {
        // Placement builds one array per grid row from the top of the board down to the widget,
        // so an unbounded row out of the request body is an allocation the sender sizes. Fifty
        // million rows is a request that ends the process, and nothing further down bounds it.
        var body = BoardDto(new WidgetInstanceDto(Guid.NewGuid(), "mnemo.recent-notes",
            new WidgetSizeDto(1, 1), 0, 50_000_000, 0, new Dictionary<string, string>()));

        var saved = await OverviewLayoutHandler.SaveAsync(_store, body, CancellationToken.None);

        Assert.Equal(OverviewLayoutSaveStatus.Malformed, saved.Status);
        Assert.Null(_store.Saved);
    }

    [Fact]
    public async Task ARowSpanFarPastTheBoardIsMalformedForTheSameReason()
    {
        // The span reaches the same loop: a widget at row 0 that is fifty million rows tall
        // allocates every row it claims to cover.
        var body = BoardDto(new WidgetInstanceDto(Guid.NewGuid(), "mnemo.recent-notes",
            new WidgetSizeDto(1, 50_000_000), 0, 0, 0, new Dictionary<string, string>()));

        var saved = await OverviewLayoutHandler.SaveAsync(_store, body, CancellationToken.None);

        Assert.Equal(OverviewLayoutSaveStatus.Malformed, saved.Status);
        Assert.Null(_store.Saved);
    }

    [Fact]
    public async Task ATallButOrdinaryBoardStillSaves()
    {
        // The bound has to sit clear of any board a person could build. A widget parked a couple
        // of hundred rows down is a long dashboard, not a broken client.
        var body = BoardDto(new WidgetInstanceDto(Guid.NewGuid(), "mnemo.recent-notes",
            new WidgetSizeDto(1, 1), 0, 200, 0, new Dictionary<string, string>()));

        var saved = await OverviewLayoutHandler.SaveAsync(_store, body, CancellationToken.None);

        Assert.Equal(OverviewLayoutSaveStatus.Saved, saved.Status);
        Assert.Equal(200, Assert.Single(_store.Saved!.Widgets).Row);
    }

    [Fact]
    public async Task AnEmptyWidgetListClearsTheBoardRatherThanFailing()
    {
        var saved = await OverviewLayoutHandler.SaveAsync(_store, BoardDto(), CancellationToken.None);

        Assert.Equal(OverviewLayoutSaveStatus.Saved, saved.Status);
        Assert.Empty(_store.Saved!.Widgets);
    }

    [Fact]
    public async Task AWidgetWithoutAnIdIsMalformedAndNothingIsWritten()
    {
        var body = BoardDto(new WidgetInstanceDto(Guid.NewGuid(), "  ", new WidgetSizeDto(1, 1), 0, 0, 0,
            new Dictionary<string, string>()));

        var saved = await OverviewLayoutHandler.SaveAsync(_store, body, CancellationToken.None);

        Assert.Equal(OverviewLayoutSaveStatus.Malformed, saved.Status);
        Assert.Null(_store.Saved);
    }

    [Fact]
    public async Task AWidgetWithoutASizeIsMalformedAndNothingIsWritten()
    {
        var body = BoardDto(new WidgetInstanceDto(Guid.NewGuid(), "mnemo.recent-notes", null!, 0, 0, 0,
            new Dictionary<string, string>()));

        var saved = await OverviewLayoutHandler.SaveAsync(_store, body, CancellationToken.None);

        Assert.Equal(OverviewLayoutSaveStatus.Malformed, saved.Status);
        Assert.Null(_store.Saved);
    }

    [Fact]
    public async Task AMissingWidgetListIsMalformedRatherThanAnEmptyBoard()
    {
        // Distinct from an empty array on purpose: clearing the board is a real edit, dropping the
        // field is a broken client, and one of the two must not silently wipe a board.
        var body = new OverviewLayoutDto(OverviewLayout.CurrentSchemaVersion, OverviewLayout.DefaultProfileId, null!);

        var saved = await OverviewLayoutHandler.SaveAsync(_store, body, CancellationToken.None);

        Assert.Equal(OverviewLayoutSaveStatus.Malformed, saved.Status);
        Assert.Null(_store.Saved);
    }

    [Fact]
    public async Task AnAllZeroInstanceIdGetsARealOne()
    {
        var body = BoardDto(new WidgetInstanceDto(Guid.Empty, "mnemo.recent-notes", new WidgetSizeDto(1, 1), 0, 0, 0,
            new Dictionary<string, string>()));

        await OverviewLayoutHandler.SaveAsync(_store, body, CancellationToken.None);

        Assert.NotEqual(Guid.Empty, Assert.Single(_store.Saved!.Widgets).InstanceId);
    }

    [Fact]
    public async Task AStoreThatRefusesTheWriteIsReportedAsAFailure()
    {
        _store.SaveResult = Result.Failure("Disk is full.");

        var saved = await OverviewLayoutHandler.SaveAsync(_store, BoardDto(), CancellationToken.None);

        Assert.Equal(OverviewLayoutSaveStatus.Failed, saved.Status);
        Assert.Equal("Disk is full.", saved.ErrorMessage);
    }

    private static OverviewLayout Board(params WidgetInstance[] widgets) => new() { Widgets = [.. widgets] };

    private static OverviewLayoutDto BoardDto(params WidgetInstanceDto[] widgets)
        => new(OverviewLayout.CurrentSchemaVersion, OverviewLayout.DefaultProfileId, widgets);

    private static WidgetInstance StoredWidget(string widgetId, int column, int row) => new()
    {
        WidgetId = widgetId,
        Size = new WidgetSize(2, 1),
        Column = column,
        Row = row,
        Order = 3,
        Settings = new Dictionary<string, string>(StringComparer.Ordinal) { ["range"] = "week" }
    };

    private sealed class FakeLayoutStore : IOverviewLayoutStore
    {
        public Result<OverviewLayout?> LoadResult { get; set; } = Result<OverviewLayout?>.Success(null);

        public Result SaveResult { get; set; } = Result.Success();

        public OverviewLayout? Saved { get; private set; }

        public Task<Result<OverviewLayout?>> LoadAsync(CancellationToken cancellationToken = default)
            => Task.FromResult(LoadResult);

        public Task<Result> SaveAsync(OverviewLayout layout, CancellationToken cancellationToken = default)
        {
            Saved = layout;
            return Task.FromResult(SaveResult);
        }
    }
}
