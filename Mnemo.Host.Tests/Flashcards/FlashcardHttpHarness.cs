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
using Mnemo.Infrastructure.Services.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards.Generation;
using Mnemo.Infrastructure.Services.Flashcards.Persistence;
using Mnemo.Infrastructure.Services.Search;
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

        Store = new FlashcardStore(new SilentLogger(), _dbPath);

        var clock = new FlashcardClock(TimeProvider.System);
        var materializer = new FlashcardCardMaterializer(cards, schedules, facts);
        var scheduler = new FsrsScheduler(clock);

        var libraryService = new FlashcardLibraryService(
            Store, folders, decks, cards, facts, schedules, reviews, dailyStats, presets, clock);
        var cardService = new FlashcardCardService(Store, cards, schedules, facts, clock);
        var factService = new FlashcardFactService(Store, facts, cardTypes, cards, materializer, clock);
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
        builder.Services.AddSingleton<IFlashcardLibraryService>(libraryService);
        builder.Services.AddSingleton<IFlashcardCardService>(cardService);
        builder.Services.AddSingleton<IFlashcardFactService>(factService);
        builder.Services.AddSingleton<IFlashcardPresetService>(presetService);
        builder.Services.AddSingleton<IFlashcardOptimizerService>(optimizerService);
        builder.Services.AddSingleton<IFlashcardStudyService>(studyService);
        builder.Services.AddSingleton<IFlashcardStatsService>(statsService);
        builder.Services.AddSingleton<IImageAssetService>(new NoopImageAssetService());
        builder.Services.AddSingleton<ISearchProvider>(searchProvider);
        builder.Services.AddSingleton<IGlobalSearchService, GlobalSearchService>();

        _app = builder.Build();
        _app.MapFlashcardLibrary();
        _app.MapFlashcardFacts();
        _app.MapFlashcardCards();
        _app.MapFlashcardAssets();
        _app.MapFlashcardPresets();
        _app.MapSearch();
    }

    public async Task StartAsync()
    {
        if (_started)
            return;
        await _app.StartAsync().ConfigureAwait(false);
        _started = true;
        _client = _app.GetTestClient();
    }

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
