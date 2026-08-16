using Mnemo.Core.Models;
using Mnemo.Core.Models.Statistics;
using Mnemo.Core.Services;
using Mnemo.Host.Statistics;
using Xunit;

namespace Mnemo.Host.Tests.Statistics;

/// <summary>
/// The day-window read is what this file is really about. Its filter, its sort and the breadth of
/// what it asks storage for all exist because the query layer can only order by UpdatedAt, and
/// every one of them fails silently: the wrong limit returns an empty window, the missing sort
/// returns a chart drawn out of order, and neither looks like an error from the client.
/// </summary>
public sealed class StatisticsHandlerTests
{
    private readonly FakeStatisticsManager _statistics = new();

    [Fact]
    public async Task GetRecordReturnsTheStoredFieldsWithTheirTypeTags()
    {
        _statistics.Record = new StatisticsRecord
        {
            Namespace = "flashcards",
            Kind = "totals",
            Key = "all",
            UpdatedAt = new DateTimeOffset(2026, 8, 8, 9, 30, 0, TimeSpan.Zero),
            Fields = new Dictionary<string, StatValue>(StringComparer.Ordinal)
            {
                ["current_streak_days"] = StatValue.FromInt(12),
                ["last_practiced"] = StatValue.FromDateTime(new DateTimeOffset(2026, 8, 7, 20, 0, 0, TimeSpan.Zero)),
                ["accuracy"] = StatValue.FromDecimal(0.5),
                ["enabled"] = StatValue.FromBool(true)
            }
        };

        var read = await StatisticsHandler.GetRecordAsync(_statistics, "flashcards", "totals", "all", CancellationToken.None);

        Assert.Equal(StatRecordStatus.Found, read.Status);
        Assert.Equal("flashcards", read.Record!.Ns);
        Assert.Equal("totals", read.Record.Kind);
        Assert.Equal("all", read.Record.Key);

        // The tag travels beside the value because a reader decides whether a field is safe to read
        // by comparing against it. A value alone cannot carry that.
        Assert.Equal("integer", read.Record.Fields["current_streak_days"].Type);
        Assert.Equal("12", read.Record.Fields["current_streak_days"].Value);
        Assert.Equal("dateTime", read.Record.Fields["last_practiced"].Type);
        Assert.Equal("decimal", read.Record.Fields["accuracy"].Type);
        Assert.Equal("boolean", read.Record.Fields["enabled"].Type);
        Assert.Equal("true", read.Record.Fields["enabled"].Value);
    }

    [Fact]
    public async Task GetRecordSeparatesAnAbsentRecordFromAFailedRead()
    {
        _statistics.Record = null;
        var absent = await StatisticsHandler.GetRecordAsync(_statistics, "flashcards", "totals", "all", CancellationToken.None);
        Assert.Equal(StatRecordStatus.Absent, absent.Status);
        Assert.Null(absent.ErrorMessage);

        // A widget reading a stat nobody has generated yet is the ordinary first-run case and shows
        // zeroes; a read that failed has to be able to say so instead.
        _statistics.GetResult = Result<StatisticsRecord?>.Failure("The statistics table is locked.");
        var failed = await StatisticsHandler.GetRecordAsync(_statistics, "flashcards", "totals", "all", CancellationToken.None);
        Assert.Equal(StatRecordStatus.Failed, failed.Status);
        Assert.Equal("The statistics table is locked.", failed.ErrorMessage);
    }

    [Theory]
    [InlineData(null, "totals", "all")]
    [InlineData("   ", "totals", "all")]
    [InlineData("flashcards", "", "all")]
    [InlineData("flashcards", "totals", null)]
    public async Task GetRecordRejectsAnIncompleteTriple(string? ns, string? kind, string? key)
    {
        var read = await StatisticsHandler.GetRecordAsync(_statistics, ns, kind, key, CancellationToken.None);

        Assert.Equal(StatRecordStatus.Invalid, read.Status);
        // Nothing is read on a rejected request, so a malformed URL cannot become a table scan.
        Assert.Null(_statistics.LastQuery);
    }

    [Fact]
    public async Task QueryRecordsPassesTheLimitThroughRatherThanRedecidingIt()
    {
        _statistics.Records = [];

        await StatisticsHandler.QueryRecordsAsync(_statistics, "flashcards", "deck.summary", "deck:", 64, false, CancellationToken.None);

        Assert.Equal("flashcards", _statistics.LastQuery!.Namespace);
        Assert.Equal("deck.summary", _statistics.LastQuery.Kind);
        Assert.Equal("deck:", _statistics.LastQuery.KeyPrefix);
        Assert.Equal(64, _statistics.LastQuery.Limit);
        Assert.False(_statistics.LastQuery.OrderByUpdatedDescending);
    }

    [Fact]
    public async Task QueryRecordsDefaultsToNewestFirstAndLeavesTheLimitToStorage()
    {
        _statistics.Records = [];

        await StatisticsHandler.QueryRecordsAsync(_statistics, "flashcards", null, "  ", null, null, CancellationToken.None);

        Assert.Null(_statistics.LastQuery!.Kind);
        Assert.Null(_statistics.LastQuery.KeyPrefix);
        // Zero is the store's "use your default" value; re-deciding it here would put two answers
        // to the same question in the codebase.
        Assert.Equal(0, _statistics.LastQuery.Limit);
        Assert.True(_statistics.LastQuery.OrderByUpdatedDescending);
    }

    [Fact]
    public async Task DailyReturnsTheWindowInDayOrderRegardlessOfWhenEachWasWritten()
    {
        // Written newest-first and with the middle day corrected last, which is what an UpdatedAt
        // ordering would surface first. The response has to be in day order anyway.
        _statistics.Records =
        [
            Daily("2026-08-05", updatedAt: new DateTimeOffset(2026, 8, 5, 12, 0, 0, TimeSpan.Zero)),
            Daily("2026-08-03", updatedAt: new DateTimeOffset(2026, 8, 9, 12, 0, 0, TimeSpan.Zero)),
            Daily("2026-08-04", updatedAt: new DateTimeOffset(2026, 8, 4, 12, 0, 0, TimeSpan.Zero))
        ];

        var read = await StatisticsHandler.QueryDailyAsync(
            _statistics, "flashcards", "daily.summary", "2026-08-03", "2026-08-05", CancellationToken.None);

        Assert.Equal(StatListStatus.Ok, read.Status);
        Assert.Equal(["2026-08-03", "2026-08-04", "2026-08-05"], read.Records.Select(r => r.Key));
    }

    [Fact]
    public async Task DailyDropsWhatIsOutsideTheWindowAndWhatIsNotADayAtAll()
    {
        _statistics.Records =
        [
            Daily("2026-08-02"),
            Daily("2026-08-03"),
            Daily("2026-08-06"),
            Daily("all")
        ];

        var read = await StatisticsHandler.QueryDailyAsync(
            _statistics, "flashcards", "daily.summary", "2026-08-03", "2026-08-05", CancellationToken.None);

        // Endpoints are inclusive, so the 3rd is in and the 2nd is out; a day with no record is
        // simply absent rather than zero-filled.
        Assert.Equal(["2026-08-03"], read.Records.Select(r => r.Key));
    }

    [Fact]
    public async Task DailyAsksStorageForMoreThanTheWindowIsWide()
    {
        _statistics.Records = [];

        await StatisticsHandler.QueryDailyAsync(
            _statistics, "flashcards", "daily.summary", "2026-08-03", "2026-08-09", CancellationToken.None);

        // A limit of seven would return the seven most recently *written* records, which are the
        // seven requested days only while the window ends today and nothing was ever backfilled.
        // A window in the past would come back empty.
        Assert.True(_statistics.LastQuery!.Limit > 7);
    }

    [Fact]
    public async Task DailyNarrowsStorageToWhateverPrefixTheTwoEndpointsShare()
    {
        _statistics.Records = [];

        await StatisticsHandler.QueryDailyAsync(
            _statistics, "flashcards", "daily.summary", "2026-08-03", "2026-08-09", CancellationToken.None);
        // Day keys are fixed-width, so every key between the endpoints starts with what they share.
        Assert.Equal("2026-08-0", _statistics.LastQuery!.KeyPrefix);

        await StatisticsHandler.QueryDailyAsync(
            _statistics, "flashcards", "daily.summary", "2025-12-30", "2026-01-02", CancellationToken.None);
        // A window across a year boundary keeps only what the two years share, so the narrowing
        // degrades rather than disappearing.
        Assert.Equal("202", _statistics.LastQuery!.KeyPrefix);
    }

    [Theory]
    [InlineData("2026-8-3", "2026-08-09")]
    [InlineData("2026-08-03", "not-a-day")]
    [InlineData("2026-08-09", "2026-08-03")]
    [InlineData("2025-01-01", "2026-12-31")]
    public async Task DailyRejectsAWindowItCannotServe(string from, string to)
    {
        var read = await StatisticsHandler.QueryDailyAsync(
            _statistics, "flashcards", "daily.summary", from, to, CancellationToken.None);

        Assert.Equal(StatListStatus.Invalid, read.Status);
        Assert.Empty(read.Records);
        Assert.Null(_statistics.LastQuery);
    }

    [Fact]
    public async Task DailyAcceptsASingleDay()
    {
        _statistics.Records = [Daily("2026-08-08")];

        var read = await StatisticsHandler.QueryDailyAsync(
            _statistics, "flashcards", "daily.summary", "2026-08-08", "2026-08-08", CancellationToken.None);

        Assert.Equal(StatListStatus.Ok, read.Status);
        Assert.Equal(["2026-08-08"], read.Records.Select(r => r.Key));
    }

    [Fact]
    public async Task DailyReportsAStorageFailureRatherThanAnEmptyWindow()
    {
        _statistics.QueryResult = Result<IReadOnlyList<StatisticsRecord>>.Failure("The statistics table is locked.");

        var read = await StatisticsHandler.QueryDailyAsync(
            _statistics, "flashcards", "daily.summary", "2026-08-03", "2026-08-09", CancellationToken.None);

        // An empty window and an unreadable one draw the same blank chart, so the difference has to
        // survive to the client.
        Assert.Equal(StatListStatus.Failed, read.Status);
        Assert.Equal("The statistics table is locked.", read.ErrorMessage);
    }

    private static StatisticsRecord Daily(string key, DateTimeOffset? updatedAt = null) => new()
    {
        Namespace = "flashcards",
        Kind = "daily.summary",
        Key = key,
        UpdatedAt = updatedAt ?? new DateTimeOffset(2026, 8, 8, 12, 0, 0, TimeSpan.Zero),
        Fields = new Dictionary<string, StatValue>(StringComparer.Ordinal)
        {
            ["cards_reviewed"] = StatValue.FromInt(4)
        }
    };

    /// <summary>
    /// Only the two read methods are implemented. The rest throw rather than returning something
    /// harmless, so a handler that starts writing statistics fails a test instead of doing it.
    /// </summary>
    private sealed class FakeStatisticsManager : IStatisticsManager
    {
        public StatisticsRecord? Record { get; set; }

        public Result<StatisticsRecord?>? GetResult { get; set; }

        public IReadOnlyList<StatisticsRecord> Records { get; set; } = [];

        public Result<IReadOnlyList<StatisticsRecord>>? QueryResult { get; set; }

        public StatisticsQuery? LastQuery { get; private set; }

        public Task<Result<StatisticsRecord?>> GetAsync(string ns, string kind, string key, CancellationToken cancellationToken = default)
            => Task.FromResult(GetResult ?? Result<StatisticsRecord?>.Success(Record));

        public Task<Result<IReadOnlyList<StatisticsRecord>>> QueryAsync(StatisticsQuery query, CancellationToken cancellationToken = default)
        {
            LastQuery = query;
            return Task.FromResult(QueryResult ?? Result<IReadOnlyList<StatisticsRecord>>.Success(Records));
        }

        public Task<Result<StatisticsRecord>> CreateAsync(StatisticsRecordWrite write, CancellationToken cancellationToken = default)
            => throw new NotSupportedException();

        public Task<Result<StatisticsRecord>> UpdateAsync(StatisticsRecordWrite write, StatisticsFieldMergeMode mergeMode = StatisticsFieldMergeMode.Merge, long? expectedVersion = null, CancellationToken cancellationToken = default)
            => throw new NotSupportedException();

        public Task<Result<StatisticsRecord>> UpsertAsync(StatisticsRecordWrite write, StatisticsFieldMergeMode mergeMode = StatisticsFieldMergeMode.Merge, CancellationToken cancellationToken = default)
            => throw new NotSupportedException();

        public Task<Result<bool>> ExistsAsync(string ns, string kind, string key, CancellationToken cancellationToken = default)
            => throw new NotSupportedException();

        public Task<Result<IReadOnlyDictionary<string, StatValue>?>> GetFieldsAsync(string ns, string kind, string key, IReadOnlyList<string> fieldNames, CancellationToken cancellationToken = default)
            => throw new NotSupportedException();

        public Task<Result> DeleteAsync(string ns, string kind, string key, CancellationToken cancellationToken = default)
            => throw new NotSupportedException();

        public Task<Result<long>> IncrementAsync(string ns, string kind, string key, string fieldName, long delta, string sourceModule, CancellationToken cancellationToken = default)
            => throw new NotSupportedException();

        public Task<Result> RegisterSchemaAsync(StatisticsSchema schema, CancellationToken cancellationToken = default)
            => throw new NotSupportedException();

        public Task<Result<StatisticsSchema?>> GetSchemaAsync(string ns, string kind, CancellationToken cancellationToken = default)
            => throw new NotSupportedException();

        public Task<Result<IReadOnlyList<StatisticsSchema>>> ListSchemasAsync(string? ns = null, CancellationToken cancellationToken = default)
            => throw new NotSupportedException();
    }
}
