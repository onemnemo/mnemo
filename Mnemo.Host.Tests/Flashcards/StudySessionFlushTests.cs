using System.Collections.Concurrent;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Models.Statistics;
using Mnemo.Core.Services;
using Mnemo.Host.Flashcards;
using Xunit;
using LogLevel = Mnemo.Core.Enums.LogLevel;

namespace Mnemo.Host.Tests.Flashcards;

/// <summary>
/// Checks activity recording for sessions left open at host shutdown.
/// </summary>
public sealed class StudySessionFlushTests
{
    [Fact]
    public async Task StoppingTheHostRecordsASessionThatWasStillOpen()
    {
        var registry = new StudySessionRegistry();
        var entry = registry.Add(
            new FakeSession("deck-a"), "Deck A", FlashcardSessionScope.Due, FlashcardAutoReveal.Off, DateTimeOffset.UtcNow);
        entry.RecordGrade();
        entry.RecordGrade();
        entry.RecordGrade();

        var statistics = new RecordingStatistics();
        var logger = new RecordingLogger();
        await using var app = BuildHost(registry, statistics, logger);

        await app.StartAsync();
        await app.StopAsync();

        var daily = Assert.Single(statistics.Writes, w => w.Kind == FlashcardStatKinds.DailySummary);
        Assert.Equal(3, daily.Fields["cards_reviewed"].AsInt());

        var deck = Assert.Single(statistics.Writes, w => w.Kind == FlashcardStatKinds.DeckSummary);
        Assert.Equal("Deck A", deck.Fields["deck_name"].AsString());

        // The recorder swallows and logs its own failures, so an incomplete fake would otherwise
        // let this test pass having written nothing.
        Assert.Empty(logger.Errors);
    }

    /// <summary>
    /// Shutdown must record abandoned sessions as well as recently active ones.
    /// </summary>
    [Fact]
    public async Task StoppingTheHostDatesTheRecordFromTheLastRequestTheSessionMade()
    {
        var registry = new StudySessionRegistry();
        var startedAt = DateTimeOffset.UtcNow - TimeSpan.FromMinutes(50);
        var entry = registry.Add(
            new FakeSession("deck-a"), "Deck A", FlashcardSessionScope.Due, FlashcardAutoReveal.Off, startedAt);
        entry.RecordGrade();
        entry.Touch(startedAt + TimeSpan.FromMinutes(5));

        var statistics = new RecordingStatistics();
        var logger = new RecordingLogger();
        await using var app = BuildHost(registry, statistics, logger);

        await app.StartAsync();
        await app.StopAsync();

        var daily = Assert.Single(statistics.Writes, w => w.Kind == FlashcardStatKinds.DailySummary);
        Assert.Equal(5, daily.Fields["minutes_studied"].AsInt());
        Assert.Empty(logger.Errors);
    }

    [Fact]
    public async Task StoppingTheHostRecordsNothingForASessionThatGradedNoCards()
    {
        var registry = new StudySessionRegistry();
        registry.Add(new FakeSession("deck-a"), "Deck A", FlashcardSessionScope.Due, FlashcardAutoReveal.Off, DateTimeOffset.UtcNow);

        var statistics = new RecordingStatistics();
        var logger = new RecordingLogger();
        await using var app = BuildHost(registry, statistics, logger);

        await app.StartAsync();
        await app.StopAsync();

        Assert.Empty(statistics.Writes);
        Assert.Empty(logger.Errors);
    }

    /// <summary>
    /// A blocked session gate must respect the host shutdown deadline.
    /// </summary>
    [Fact]
    public async Task StoppingGivesUpOnASessionWhoseGateNobodyLetsGoOf()
    {
        var registry = new StudySessionRegistry();
        var entry = registry.Add(
            new FakeSession("deck-a"), "Deck A", FlashcardSessionScope.Due, FlashcardAutoReveal.Off, DateTimeOffset.UtcNow);
        entry.RecordGrade();

        var holding = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var letGo = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var holder = entry.MutateAsync(async () =>
        {
            holding.SetResult();
            await letGo.Task;
        }, CancellationToken.None);
        await holding.Task;

        var statistics = new RecordingStatistics();
        var logger = new RecordingLogger();
        var flush = new StudySessionFlush(registry, statistics, new FixedStudyDay(), logger);

        try
        {
            using var teardown = new CancellationTokenSource();
            var stopping = flush.StopAsync(teardown.Token);
            teardown.CancelAfter(TimeSpan.FromMilliseconds(200));

            var finished = await Task.WhenAny(stopping, Task.Delay(TimeSpan.FromSeconds(10)));
            Assert.True(ReferenceEquals(finished, stopping), "the flush was still waiting for a gate nobody was going to release");
            await stopping;

            Assert.Empty(statistics.Writes);
            Assert.Single(logger.Warnings);
        }
        finally
        {
            letGo.SetResult();
            await holder;
        }
    }

    private static WebApplication BuildHost(
        StudySessionRegistry registry,
        IStatisticsManager statistics,
        ILoggerService logger)
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Logging.ClearProviders();

        builder.Services.AddSingleton(registry);
        builder.Services.AddSingleton(statistics);
        builder.Services.AddSingleton<IStudyDayService>(new FixedStudyDay());
        builder.Services.AddSingleton(logger);
        builder.Services.AddHostedService<StudySessionFlush>();

        return builder.Build();
    }

    /// <summary>
    /// Records writes and reports missing rows on reads. Unexpected operations throw.
    /// </summary>
    private sealed class RecordingStatistics : IStatisticsManager
    {
        private readonly ConcurrentQueue<StatisticsRecordWrite> _writes = new();

        public IReadOnlyList<StatisticsRecordWrite> Writes => [.. _writes];

        public Task<Result<StatisticsRecord?>> GetAsync(string ns, string kind, string key, CancellationToken cancellationToken = default)
            => Task.FromResult(Result<StatisticsRecord?>.Success(null));

        public Task<Result<StatisticsRecord>> UpsertAsync(
            StatisticsRecordWrite write,
            StatisticsFieldMergeMode mergeMode = StatisticsFieldMergeMode.Merge,
            CancellationToken cancellationToken = default)
        {
            _writes.Enqueue(write);
            return Task.FromResult(Result<StatisticsRecord>.Success(new StatisticsRecord
            {
                Namespace = write.Namespace,
                Kind = write.Kind,
                Key = write.Key,
                SourceModule = write.SourceModule,
                Fields = write.Fields,
            }));
        }

        public Task<Result<StatisticsRecord>> CreateAsync(StatisticsRecordWrite write, CancellationToken cancellationToken = default)
            => throw new NotSupportedException();

        public Task<Result<StatisticsRecord>> UpdateAsync(StatisticsRecordWrite write, StatisticsFieldMergeMode mergeMode = StatisticsFieldMergeMode.Merge, long? expectedVersion = null, CancellationToken cancellationToken = default)
            => throw new NotSupportedException();

        public Task<Result<bool>> ExistsAsync(string ns, string kind, string key, CancellationToken cancellationToken = default)
            => throw new NotSupportedException();

        public Task<Result<IReadOnlyDictionary<string, StatValue>?>> GetFieldsAsync(string ns, string kind, string key, IReadOnlyList<string> fieldNames, CancellationToken cancellationToken = default)
            => throw new NotSupportedException();

        public Task<Result> DeleteAsync(string ns, string kind, string key, CancellationToken cancellationToken = default)
            => throw new NotSupportedException();

        public Task<Result<long>> IncrementAsync(string ns, string kind, string key, string fieldName, long delta, string sourceModule, CancellationToken cancellationToken = default)
            => throw new NotSupportedException();

        public Task<Result<IReadOnlyList<StatisticsRecord>>> QueryAsync(StatisticsQuery query, CancellationToken cancellationToken = default)
            => throw new NotSupportedException();

        public Task<Result> RegisterSchemaAsync(StatisticsSchema schema, CancellationToken cancellationToken = default)
            => throw new NotSupportedException();

        public Task<Result<StatisticsSchema?>> GetSchemaAsync(string ns, string kind, CancellationToken cancellationToken = default)
            => throw new NotSupportedException();

        public Task<Result<IReadOnlyList<StatisticsSchema>>> ListSchemasAsync(string? ns = null, CancellationToken cancellationToken = default)
            => throw new NotSupportedException();
    }

    /// <summary>Every instant belongs to one fixed day, so a run near a boundary cannot flip.</summary>
    private sealed class FixedStudyDay : IStudyDayService
    {
        private static readonly DateOnly Day = new(2026, 5, 1);

        public ValueTask<int> GetDayStartHourAsync(CancellationToken cancellationToken = default) => ValueTask.FromResult(4);

        public ValueTask<DateOnly> DayOfAsync(DateTimeOffset instant, CancellationToken cancellationToken = default) => ValueTask.FromResult(Day);

        public ValueTask<DateOnly> TodayAsync(CancellationToken cancellationToken = default) => ValueTask.FromResult(Day);

        public ValueTask<string> KeyForAsync(DateTimeOffset instant, CancellationToken cancellationToken = default)
            => ValueTask.FromResult(IStudyDayService.KeyOf(Day));

        public ValueTask<string> TodayKeyAsync(CancellationToken cancellationToken = default)
            => ValueTask.FromResult(IStudyDayService.KeyOf(Day));
    }

    private sealed class RecordingLogger : ILoggerService
    {
        private readonly ConcurrentQueue<string> _errors = new();
        private readonly ConcurrentQueue<string> _warnings = new();

        public IReadOnlyList<string> Errors => [.. _errors];

        public IReadOnlyList<string> Warnings => [.. _warnings];

        public void Log(LogLevel level, string category, string message, Exception? exception = null)
        {
            if (level >= LogLevel.Error)
                _errors.Enqueue($"{category}: {message} {exception}");
            else if (level == LogLevel.Warning)
                _warnings.Enqueue($"{category}: {message}");
        }
    }

    private sealed class FakeSession(string deckId) : IFlashcardSession
    {
        public FlashcardSessionMode Mode => FlashcardSessionMode.Review;
        public string DeckId { get; } = deckId;
        public bool WritesSchedule => true;
        public bool IsFinished => false;
        public FlashcardView? Current => null;
        public FlashcardSessionProgress Progress => FlashcardSessionProgress.Empty;
        public string DescribeInterval(FlashcardReviewGrade grade) => "";
        public Task GradeAsync(FlashcardReviewGrade grade, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task<bool> UndoAsync(CancellationToken cancellationToken = default) => Task.FromResult(false);
    }
}
