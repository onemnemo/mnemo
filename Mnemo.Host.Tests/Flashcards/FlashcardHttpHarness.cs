using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.Core.Services.Search;
using Mnemo.Host.Flashcards;
using Mnemo.Host.Trash;
using Mnemo.Infrastructure.Services.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards.Generation;
using Mnemo.Infrastructure.Services.Flashcards.Persistence;
using Mnemo.Infrastructure.Services.Flashcards.Trash;
using Mnemo.Infrastructure.Services.Search;
using Mnemo.Infrastructure.Services.Trash;
using LogLevel = Mnemo.Core.Enums.LogLevel;

namespace Mnemo.Host.Tests.Flashcards;

/// <summary>
/// The flashcards service stack, wired by hand over a throwaway database and mapped onto its
/// real HTTP routes through TestServer. Built directly rather than through
/// <c>HostComposition.AddMnemoBackend</c>, which registers the whole backend graph (chat, AI,
/// notes, the single-instance lock) that nothing here exercises; a request still runs the
/// production endpoint code, model binding included, just over a service graph scoped to
/// flashcards and search.
/// </summary>
internal sealed class FlashcardHttpHarness : IAsyncDisposable
{
    private readonly string _dbPath;
    private readonly WebApplication _app;
    private readonly TrashDatabase _trashDatabase;
    private bool _started;
    private HttpClient? _client;

    public FlashcardStore Store { get; }

    /// <summary>
    /// Only valid once <see cref="StartAsync"/> has run: <c>TestServer</c> refuses to hand out a
    /// client for an application that has not been started yet.
    /// </summary>
    public HttpClient Client => _client ?? throw new InvalidOperationException(
        "Call StartAsync before using Client.");

    public FlashcardHttpHarness()
    {
        _dbPath = Path.Combine(Path.GetTempPath(), $"mnemo_host_fc_{Guid.NewGuid():N}.db");

        var folders = new FolderRepository();
        var presets = new PresetRepository();
        var decks = new DeckRepository();
        var cards = new CardRepository();
        var cardTypes = new CardTypeRepository();
        var facts = new FactRepository();
        var schedules = new ScheduleRepository();
        var reviews = new ReviewRepository();
        var testAttempts = new TestAttemptRepository();
        var dailyStats = new DailyStatsRepository();

        var logger = new SilentLogger();
        Store = new FlashcardStore(logger, _dbPath);

        // The trash tables live in the same file the collection does, as they do in the app, so a
        // capture and the write it interrupts cannot end up in two different transactions.
        _trashDatabase = new TrashDatabase(logger, _dbPath);

        var clock = new FlashcardClock(TimeProvider.System);
        var materializer = new FlashcardCardMaterializer(cards, schedules, facts);
        var scheduler = new FsrsScheduler(clock);

        var libraryService = new FlashcardLibraryService(
            Store, folders, decks, cards, facts, schedules, reviews, dailyStats, presets, clock);
        var cardService = new FlashcardCardService(Store, cards, schedules, facts, clock);
        var presetService = new FlashcardPresetService(Store, presets, decks, clock);
        var optimizerService = new FlashcardOptimizerService(Store, presets, reviews);
        var studyService = new FlashcardStudyService(
            Store, decks, schedules, presets, reviews, dailyStats, cards, facts, scheduler, clock);
        var statsService = new FlashcardStatsService(Store, reviews, testAttempts, decks, presets, clock);
        var searchProvider = new FlashcardsSearchProvider(cardService, libraryService);

        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseTestServer();
        builder.Logging.ClearProviders();

        builder.Services.AddSingleton(clock);
        builder.Services.AddSingleton<ILoggerService>(logger);
        builder.Services.AddSingleton<IFlashcardLibraryService>(libraryService);
        builder.Services.AddSingleton<IFlashcardCardService>(cardService);
        // Resolved rather than built above, because the material surface sweeps a card that lost
        // its layout into the trash and the trash is registered below it.
        builder.Services.AddSingleton<IFlashcardFactService>(sp => new FlashcardFactService(
            Store, facts, cardTypes, cards, materializer, clock, sp.GetRequiredService<ITrashService>()));
        builder.Services.AddSingleton<IFlashcardPresetService>(presetService);
        builder.Services.AddSingleton<IFlashcardOptimizerService>(optimizerService);
        builder.Services.AddSingleton<IFlashcardStudyService>(studyService);
        builder.Services.AddSingleton<IFlashcardStatsService>(statsService);
        builder.Services.AddSingleton<IImageAssetService>(new NoopImageAssetService());
        builder.Services.AddSingleton<ISearchProvider>(searchProvider);
        builder.Services.AddSingleton<IGlobalSearchService, GlobalSearchService>();

        // The real trash coordinator over the four flashcard sources, so a delete route runs the
        // production path rather than a stand in: nothing here is destroyed, it is held.
        builder.Services.AddSingleton(_trashDatabase);
        builder.Services.AddSingleton<ITrashStore>(new TrashStore(_trashDatabase));
        builder.Services.AddSingleton<IAssetCleanupStore>(new AssetCleanupStore(_trashDatabase));
        builder.Services.AddSingleton(new TrashSourceRegistry([
            new FlashcardDeckFolderTrashSource(Store, logger),
            new FlashcardDeckTrashSource(Store, logger),
            new FlashcardFactTrashSource(Store, logger),
            new FlashcardCardTrashSource(Store, logger),
        ]));
        builder.Services.AddSingleton<TrashMaintenance>();
        builder.Services.AddSingleton<ITrashMaintenance>(sp => sp.GetRequiredService<TrashMaintenance>());
        builder.Services.AddSingleton<AssetCleanupWorker>();
        builder.Services.AddSingleton<ITrashService>(sp => new TrashService(
            sp.GetRequiredService<ITrashStore>(),
            sp.GetRequiredService<TrashSourceRegistry>(),
            sp.GetRequiredService<ILoggerService>(),
            sp.GetRequiredService<ITrashMaintenance>()));

        _app = builder.Build();
        _app.MapFlashcardLibrary();
        _app.MapFlashcardFacts();
        _app.MapFlashcardCards();
        _app.MapFlashcardAssets();
        _app.MapFlashcardPresets();
        _app.MapSearch();
        _app.MapTrash();
    }

    public async Task StartAsync()
    {
        if (_started)
            return;
        await _app.StartAsync().ConfigureAwait(false);
        _started = true;
        _client = _app.GetTestClient();

        // Every trash route, and so every delete route, stays closed until the first reconciliation
        // pass finishes.
        var maintenance = _app.Services.GetRequiredService<TrashMaintenance>();
        maintenance.StartInBackground();

        // The first pass constructs the trash service and reads every source off a data root that
        // has just been created. On a cold CI runner, with the other test classes on the same disk,
        // that has taken longer than ten seconds; a genuinely stuck pass is still caught.
        var deadline = DateTime.UtcNow.AddSeconds(30);
        while (!maintenance.IsReady)
        {
            if (DateTime.UtcNow > deadline)
                throw new TimeoutException("The trash never finished starting.");
            await Task.Delay(10).ConfigureAwait(false);
        }
    }

    /// <summary>The trash coordinator the delete routes run through.</summary>
    public ITrashService Trash => _app.Services.GetRequiredService<ITrashService>();

    /// <summary>
    /// The library service behind the deck routes, for reaching the outright delete the desktop app
    /// uses. The HTTP delete route only ever moves a deck to the trash.
    /// </summary>
    public IFlashcardLibraryService Library => _app.Services.GetRequiredService<IFlashcardLibraryService>();

    public async ValueTask DisposeAsync()
    {
        _client?.Dispose();
        if (_started)
            await _app.StopAsync().ConfigureAwait(false);
        await _app.DisposeAsync().ConfigureAwait(false);
        await Store.DisposeAsync().ConfigureAwait(false);
        await _trashDatabase.DisposeAsync().ConfigureAwait(false);

        foreach (var suffix in new[] { "", "-wal", "-shm" })
        {
            try { File.Delete(_dbPath + suffix); }
            catch { /* best effort: a held WAL sidecar is not a test failure */ }
        }
    }

    private sealed class SilentLogger : ILoggerService
    {
        public void Log(LogLevel level, string category, string message, Exception? exception = null)
        {
        }
    }

    /// <summary>Nothing here exercises the note image-block path, so every call is a safe no-op.</summary>
    private sealed class NoopImageAssetService : IImageAssetService
    {
        public Task<Result<string>> ImportAndCopyAsync(string sourcePath, string blockId, CancellationToken cancellationToken = default) =>
            Task.FromResult(Result<string>.Success(sourcePath));

        public Task<Result> DeleteStoredFileAsync(string absolutePath, CancellationToken cancellationToken = default) =>
            Task.FromResult(Result.Success());
    }
}
