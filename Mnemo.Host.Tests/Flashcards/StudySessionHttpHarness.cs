using System.Collections.Concurrent;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Services;
using Mnemo.Host.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards.Persistence;
using Mnemo.Infrastructure.Services.Statistics;
using LogLevel = Mnemo.Core.Enums.LogLevel;

namespace Mnemo.Host.Tests.Flashcards;

/// <summary>
/// The study loop over its real routes: a real store on a throwaway database, the real session
/// engine, the real registry and study-day service, and the statistics manager over its in-memory
/// store. Decks and cards are seeded through the services rather than mapped, because what is
/// under test here is what one grade request writes, not the library surface.
/// </summary>
internal sealed class StudySessionHttpHarness : IAsyncDisposable
{
    private readonly string _dbPath;
    private readonly WebApplication _app;
    private readonly ReviewRepository _reviews = new();
    private readonly ScheduleRepository _schedules = new();
    private bool _started;
    private HttpClient? _client;

    public FlashcardStore Store { get; }

    public IFlashcardLibraryService Library { get; }

    public IFlashcardCardService Cards { get; }

    public IStatisticsManager Statistics { get; }

    public IStudyDayService StudyDay { get; }

    public RecordingLogger Logger { get; } = new();

    public HttpClient Client => _client ?? throw new InvalidOperationException(
        "Call StartAsync before using Client.");

    public StudySessionHttpHarness()
    {
        _dbPath = Path.Combine(Path.GetTempPath(), $"mnemo_host_study_{Guid.NewGuid():N}.db");

        var folders = new FolderRepository();
        var presets = new PresetRepository();
        var decks = new DeckRepository();
        var cards = new CardRepository();
        var facts = new FactRepository();
        var reviews = _reviews;
        var schedules = _schedules;
        var testAttempts = new TestAttemptRepository();
        var dailyStats = new DailyStatsRepository();

        Store = new FlashcardStore(Logger, _dbPath);

        var clock = new FlashcardClock(TimeProvider.System);
        var scheduler = new FsrsScheduler(clock);

        var libraryService = new FlashcardLibraryService(
            Store, folders, decks, cards, facts, schedules, reviews, dailyStats, presets, clock);
        var cardService = new FlashcardCardService(Store, cards, schedules, facts, clock);
        var presetService = new FlashcardPresetService(Store, presets, decks, clock);
        var studyService = new FlashcardStudyService(
            Store, decks, schedules, presets, reviews, dailyStats, cards, facts, scheduler, clock);
        var studyDay = new StudyDayService(presetService, clock);
        var statistics = StatisticsManager.CreateInMemory(Logger);

        Library = libraryService;
        Cards = cardService;
        Statistics = statistics;
        StudyDay = studyDay;

        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Logging.ClearProviders();

        builder.Services.AddSingleton(clock);
        builder.Services.AddSingleton<ILoggerService>(Logger);
        builder.Services.AddSingleton<IFlashcardLibraryService>(libraryService);
        builder.Services.AddSingleton<IFlashcardPresetService>(presetService);
        builder.Services.AddSingleton<IFlashcardStudyService>(studyService);
        builder.Services.AddSingleton<IStudyDayService>(studyDay);
        builder.Services.AddSingleton<IStatisticsManager>(statistics);
        builder.Services.AddSingleton<StudySessionRegistry>();

        _app = builder.Build();
        _app.MapFlashcardStudySessions();
    }

    public async Task StartAsync()
    {
        if (_started)
            return;
        await _app.StartAsync().ConfigureAwait(false);
        _started = true;
        _client = _app.GetTestClient();
    }

    /// <summary>A deck holding one new card per front, in creation order.</summary>
    public async Task<(string DeckId, IReadOnlyList<Flashcard> Cards)> SeedDeckAsync(params string[] fronts)
    {
        var deck = await Library.CreateDeckAsync("Study").ConfigureAwait(false);
        var drafts = fronts
            .Select(front => new FlashcardCardDraft(deck.Id, FlashcardType.Classic, front, $"{front} back", [], []))
            .ToList();
        var created = await Cards.CreateCardsAsync(deck.Id, drafts).ConfigureAwait(false);
        return (deck.Id, created);
    }

    public Task<IReadOnlyList<FlashcardReviewLog>> ReadReviewsAsync(string deckId) =>
        Store.ReadAsync((conn, ct) => _reviews.ListAllForDeckAsync(conn, deckId, ct));

    public Task<FlashcardSchedule?> ReadScheduleAsync(string cardId) =>
        Store.ReadAsync((conn, ct) => _schedules.GetAsync(conn, cardId, ct));

    public async ValueTask DisposeAsync()
    {
        _client?.Dispose();
        if (_started)
            await _app.StopAsync().ConfigureAwait(false);
        await _app.DisposeAsync().ConfigureAwait(false);
        await Store.DisposeAsync().ConfigureAwait(false);

        foreach (var suffix in new[] { "", "-wal", "-shm" })
        {
            try { File.Delete(_dbPath + suffix); }
            catch { /* best effort: a held WAL sidecar is not a test failure */ }
        }
    }

    /// <summary>
    /// Keeps what was logged at error level. The activity recorder swallows its own failures and
    /// logs them, so a session that ended without a record would otherwise look like one that
    /// simply graded nothing.
    /// </summary>
    internal sealed class RecordingLogger : ILoggerService
    {
        private readonly ConcurrentQueue<string> _errors = new();

        public IReadOnlyList<string> Errors => [.. _errors];

        public void Log(LogLevel level, string category, string message, Exception? exception = null)
        {
            if (level >= LogLevel.Error)
                _errors.Enqueue($"{category}: {message} {exception}");
        }
    }
}
