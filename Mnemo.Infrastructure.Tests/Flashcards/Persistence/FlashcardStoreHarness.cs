using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards.Persistence;
using Mnemo.Infrastructure.Tests.Widgets;

namespace Mnemo.Infrastructure.Tests.Flashcards.Persistence;

/// <summary>
/// Spins up a <see cref="FlashcardStore"/> over a throwaway temp database with all repositories wired,
/// and cleans up the file (plus WAL sidecars) on dispose.
/// </summary>
internal sealed class FlashcardStoreHarness : IAsyncDisposable
{
    private readonly string _dbPath;

    public FlashcardStore Store { get; }
    public FolderRepository Folders { get; } = new();
    public PresetRepository Presets { get; } = new();
    public DeckRepository Decks { get; } = new();
    public CardRepository Cards { get; } = new();
    public ScheduleRepository Schedules { get; } = new();
    public ReviewRepository Reviews { get; } = new();
    public TestAttemptRepository TestAttempts { get; } = new();
    public DailyStatsRepository DailyStats { get; } = new();

    public FlashcardStoreHarness()
    {
        _dbPath = Path.Combine(Path.GetTempPath(), $"mnemo_fc_{Guid.NewGuid():N}.db");
        Store = new FlashcardStore(new TestLogger(), _dbPath);
    }

    /// <summary>Seeds a preset + deck so cards satisfy the foreign keys, and returns the deck id.</summary>
    public async Task<string> SeedDeckAsync(string deckId = "deck-1", string presetId = FlashcardPreset.StandardPresetId)
    {
        var now = DateTimeOffset.UtcNow;
        await Store.WriteAsync(async (conn, tx, ct) =>
        {
            await Presets.UpsertAsync(conn, tx, FlashcardPreset.CreateStandard(now) with { Id = presetId }, ct);
            await Decks.UpsertAsync(conn, tx, new FlashcardDeckHeader(
                deckId, null, presetId, "Deck", null, Array.Empty<string>(), 0, null, now, now), ct);
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
        await Store.DisposeAsync();
        foreach (var suffix in new[] { "", "-wal", "-shm" })
        {
            try { File.Delete(_dbPath + suffix); }
            catch { /* best effort */ }
        }
    }
}
