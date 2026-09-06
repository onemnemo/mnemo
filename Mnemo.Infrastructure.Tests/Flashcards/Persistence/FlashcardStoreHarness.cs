using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Models.Trash;
using Mnemo.Infrastructure.Services.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards.Generation;
using Mnemo.Infrastructure.Services.Flashcards.Persistence;
using Mnemo.Infrastructure.Services.Flashcards.Trash;
using Mnemo.Infrastructure.Services.Trash;
using Mnemo.Infrastructure.Tests.Widgets;

namespace Mnemo.Infrastructure.Tests.Flashcards.Persistence;

/// <summary>
/// Spins up a <see cref="FlashcardStore"/> over a throwaway temp database with all repositories wired,
/// and cleans up the file (plus WAL sidecars) on dispose.
/// </summary>
internal sealed class FlashcardStoreHarness : IAsyncDisposable
{
    private readonly string _dbPath;
    private readonly TrashDatabase _trashDatabase;

    public FlashcardStore Store { get; }
    public FolderRepository Folders { get; } = new();
    public PresetRepository Presets { get; } = new();
    public DeckRepository Decks { get; } = new();
    public CardRepository Cards { get; } = new();
    public CardTypeRepository CardTypes { get; } = new();
    public FactRepository Facts { get; } = new();
    public ScheduleRepository Schedules { get; } = new();
    public ReviewRepository Reviews { get; } = new();
    public TestAttemptRepository TestAttempts { get; } = new();
    public DailyStatsRepository DailyStats { get; } = new();

    /// <summary>The clock the wired services read. Move it to test a day boundary.</summary>
    public TestTimeProvider Time { get; }
    public FlashcardClock Clock { get; }

    /// <summary>Turns a fact into the cards it makes, the way saving one does.</summary>
    public FlashcardCardMaterializer Materializer { get; }

    /// <summary>
    /// The application trash over the four flashcard sources, so a save that drops a card runs the
    /// same path a person's Delete does.
    /// </summary>
    public TrashService Trash { get; }

    /// <summary>The material surface, wired over this store.</summary>
    public FlashcardFactService FactService { get; }

    /// <param name="now">The instant the services see. Defaults to the real one for tests that do not care.</param>
    /// <param name="zone">The study day's time zone. Defaults to UTC so a day key does not depend on the build machine.</param>
    public FlashcardStoreHarness(DateTimeOffset? now = null, TimeZoneInfo? zone = null)
    {
        Time = new TestTimeProvider(now ?? DateTimeOffset.UtcNow, zone);
        Clock = new FlashcardClock(Time);
        _dbPath = Path.Combine(Path.GetTempPath(), $"mnemo_fc_{Guid.NewGuid():N}.db");
        var logger = new TestLogger();
        Store = new FlashcardStore(logger, _dbPath, Time);
        Materializer = new FlashcardCardMaterializer(Cards, Schedules, Facts);

        // The ledger lives in the collection's own file, as it does in the app.
        _trashDatabase = new TrashDatabase(logger, _dbPath);
        Trash = new TrashService(
            new TrashStore(_trashDatabase),
            new TrashSourceRegistry([
                new FlashcardDeckFolderTrashSource(Store, logger),
                new FlashcardDeckTrashSource(Store, logger),
                new FlashcardFactTrashSource(Store, logger),
                new FlashcardCardTrashSource(Store, logger),
            ]),
            logger,
            time: Time);

        FactService = new FlashcardFactService(Store, Facts, CardTypes, Cards, Materializer, Clock, Trash);
    }

    /// <summary>Every entry the trash is holding, newest first.</summary>
    public async Task<IReadOnlyList<TrashEntry>> HeldAsync()
    {
        var page = await Trash.ListAsync(new TrashListQuery(Limit: 200));
        return [.. page.Entries.Select(listing => listing.Entry)];
    }

    /// <summary>Seeds a preset + deck so cards satisfy the foreign keys, and returns the deck id.</summary>
    public async Task<string> SeedDeckAsync(string deckId = "deck-1", string presetId = FlashcardPreset.StandardPresetId)
    {
        var now = DateTimeOffset.UtcNow;
        await Store.WriteAsync(async (conn, tx, ct) =>
        {
            await Presets.UpsertAsync(conn, tx, FlashcardPreset.CreateStandard(now) with { Id = presetId }, ct);
            await Decks.UpsertAsync(conn, tx, new FlashcardDeckHeader(
                deckId, null, presetId, "Deck", null, Array.Empty<string>(), 0, null, null, now, now), ct);
        });
        return deckId;
    }

    /// <summary>Inserts a card + its schedule atomically.</summary>
    public Task AddCardAsync(Flashcard card, FlashcardSchedule schedule, CancellationToken ct = default) =>
        Store.WriteAsync(async (conn, tx, token) =>
        {
            await Cards.InsertAsync(conn, tx, card, token);
            await Schedules.UpsertAsync(conn, tx, schedule, token);
        }, ct);

    public static Flashcard Card(string id, string deckId, string front, string back,
        FlashcardCardState state = FlashcardCardState.Active, FlashcardType type = FlashcardType.Classic) =>
        new(id, deckId, type, front, back, Array.Empty<string>(), state, false,
            Array.Empty<FlashcardAttachment>(), null, null, null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);

    public async ValueTask DisposeAsync()
    {
        Trash.Dispose();
        await _trashDatabase.DisposeAsync();
        await Store.DisposeAsync();
        foreach (var suffix in new[] { "", "-wal", "-shm" })
        {
            try { File.Delete(_dbPath + suffix); }
            catch { /* best effort */ }
        }
    }
}
