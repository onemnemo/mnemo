using System;
using System.Collections.Generic;
using System.IO;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards.Generation;
using Mnemo.Infrastructure.Services.Flashcards.Persistence;
using Mnemo.Infrastructure.Tests.Widgets;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Flashcards.Persistence;

/// <summary>
/// Opening a collection whose cloze material holds a deletion that wraps a line.
/// </summary>
/// <remarks>
/// Each case seeds the cards the old line-bound pattern would have written, stamps the collection at
/// the version before the repair, and opens it. What matters is not only that the markup goes: a card
/// that was already there has to come out the other side with its own id and its own history, and
/// material the repair cannot fix without losing a card has to be left alone rather than rebuilt.
/// </remarks>
public sealed class FlashcardClozeWrapRepairTests
{
    private const string WrappedText =
        "The heart has {{c1::four}} chambers and the {{c2::left\nventricle}} is thickest";

    // What the old pattern made of it: one card, with the deletion it could not read left verbatim
    // on both sides.
    private const string StaleFront =
        "The heart has […] chambers and the {{c2::left\nventricle}} is thickest";

    private const string StaleBack =
        "The heart has four chambers and the {{c2::left\nventricle}} is thickest";

    [Fact]
    public async Task A_wrapped_deletion_stops_being_printed_on_the_cards_it_belongs_to()
    {
        await using var db = new Collection();
        await db.SeedAsync(WrappedText, ("c1", "card-1", StaleFront, StaleBack));

        await db.OpenAsync();

        var card = await db.CardAsync("card-1");
        Assert.DoesNotContain("{{c2::", card.Front, StringComparison.Ordinal);
        Assert.DoesNotContain("{{c2::", card.Back, StringComparison.Ordinal);
        Assert.Equal(
            $"The heart has {FlashcardGeneration.ClozePlaceholder} chambers and the left\nventricle is thickest",
            card.Front);
        Assert.Equal("The heart has four chambers and the left\nventricle is thickest", card.Back);
    }

    [Fact]
    public async Task The_deletion_that_never_got_a_card_gets_one()
    {
        await using var db = new Collection();
        await db.SeedAsync(WrappedText, ("c1", "card-1", StaleFront, StaleBack));

        await db.OpenAsync();

        var cards = await db.CardsAsync();
        Assert.Equal(2, cards.Count);

        var made = Assert.Single(cards, c => c.LayoutKey == "c2");
        Assert.Equal(
            $"The heart has four chambers and the {FlashcardGeneration.ClozePlaceholder} is thickest",
            made.Front);
        Assert.Equal("The heart has four chambers and the left\nventricle is thickest", made.Back);
        Assert.True(await db.HasScheduleAsync(made.Id), "A card the repair makes needs a schedule to be studied.");
    }

    [Fact]
    public async Task The_card_that_was_already_there_keeps_its_id_and_its_history()
    {
        await using var db = new Collection();
        await db.SeedAsync(WrappedText, ("c1", "card-1", StaleFront, StaleBack));
        await db.RecordProgressAsync("card-1", reps: 7, lapses: 2);

        await db.OpenAsync();

        // Rewritten in place rather than replaced, which is the whole point: the card matched its
        // deletion by key, so the schedule it had been building is still the one it has.
        var card = await db.CardAsync("card-1");
        Assert.DoesNotContain("{{c2::", card.Front, StringComparison.Ordinal);

        var schedule = await db.ScheduleAsync("card-1");
        Assert.Equal(7, schedule.Reps);
        Assert.Equal(2, schedule.Lapses);
    }

    [Fact]
    public async Task Material_the_widened_pattern_reads_no_differently_is_left_untouched()
    {
        // A marker with no closing braces is not a deletion under either pattern, so this material
        // carries a literal one and is still exactly what generation makes of it. Rewriting it would
        // report every card in the collection as freshly edited for no gain.
        const string text = "The heart has {{c1::four}} chambers {{c2::unclosed";
        const string front = "The heart has […] chambers {{c2::unclosed";
        const string back = "The heart has four chambers {{c2::unclosed";

        await using var db = new Collection();
        await db.SeedAsync(text, ("c1", "card-1", front, back));

        await db.OpenAsync();

        var card = await db.CardAsync("card-1");
        Assert.Equal(front, card.Front);
        Assert.Equal(Collection.SeededAt, card.UpdatedAt);
    }

    [Fact]
    public async Task Material_that_could_only_be_rebuilt_by_losing_a_card_is_left_alone()
    {
        // Reading the inner marker as the deletion is the better answer, but it costs the card the
        // outer one made, and an upgrade running before anyone has opened the app does not get to
        // delete a review history. The next ordinary save reconciles it, with the editor saying so
        // first.
        const string text = "The heart has {{c1::four {{c2::chambers}}";
        Assert.Equal([2], FlashcardGeneration.ClozeOrdinals(text));

        const string front = "The heart has […]";
        const string back = "The heart has four {{c2";

        await using var db = new Collection();
        await db.SeedAsync(text, ("c1", "card-1", front, back));

        await db.OpenAsync();

        var card = Assert.Single(await db.CardsAsync());
        Assert.Equal("c1", card.LayoutKey);
        Assert.Equal(front, card.Front);
        Assert.Equal(Collection.SeededAt, card.UpdatedAt);
    }

    private sealed record CardRow(string Id, string Front, string Back, string? LayoutKey, string UpdatedAt);

    private sealed record ScheduleRow(int Reps, int Lapses);

    /// <summary>
    /// A collection on the version before the repair, holding whatever the old pattern would have
    /// written. Opening it is what runs the upgrade.
    /// </summary>
    private sealed class Collection : IAsyncDisposable
    {
        /// <summary>The version the repair steps up from.</summary>
        private const int VersionBeforeTheRepair = 10;

        private const string DeckId = "deck-1";
        private const string FactId = "fact-1";

        private static readonly DateTimeOffset Seeded = new(2026, 3, 4, 9, 0, 0, TimeSpan.Zero);
        private static readonly DateTimeOffset Opened = new(2026, 8, 22, 9, 0, 0, TimeSpan.Zero);

        /// <summary>The stamp a card keeps when the repair decides it has nothing to do.</summary>
        public static string SeededAt => FlashcardSqlMap.Ts(Seeded);

        private readonly string _path = Path.Combine(Path.GetTempPath(), $"mnemo_clozewrap_{Guid.NewGuid():N}.db");

        public async Task SeedAsync(string text, params (string LayoutKey, string CardId, string Front, string Back)[] cards)
        {
            await using (var store = new FlashcardStore(new TestLogger(), _path, new TestTimeProvider(Seeded)))
            {
                await store.InitializeAsync();
                await store.WriteAsync(async (conn, tx, ct) =>
                {
                    await new PresetRepository().UpsertAsync(conn, tx, FlashcardPreset.CreateStandard(Seeded), ct);
                    await new DeckRepository().UpsertAsync(conn, tx, new FlashcardDeckHeader(
                        DeckId, null, FlashcardPreset.StandardPresetId, "Deck", null, [], 0, null, null, Seeded, Seeded), ct);

                    await new FactRepository().UpsertAsync(conn, tx, new FlashcardFact(
                        Id: FactId,
                        DeckId: DeckId,
                        TypeId: FlashcardCardType.ClozeId,
                        Values: new Dictionary<string, string> { [FlashcardCardType.ClozeTextFieldId] = text },
                        Media: new Dictionary<string, IReadOnlyList<FlashcardAttachment>>(),
                        Tags: [],
                        IsFlagged: false,
                        SourceInfo: null,
                        CreatedAt: Seeded,
                        UpdatedAt: Seeded), ct);

                    foreach (var (layoutKey, cardId, front, back) in cards)
                    {
                        await new CardRepository().InsertAsync(conn, tx, new Flashcard(
                            cardId, DeckId, FlashcardType.Cloze, front, back, [], FlashcardCardState.Active, false, [],
                            SourceInfo: null, FrontBlocks: null, BackBlocks: null,
                            CreatedAt: Seeded, UpdatedAt: Seeded, FactId: FactId, LayoutKey: layoutKey), ct);
                        await new ScheduleRepository().UpsertAsync(conn, tx, FlashcardSchedule.NewFor(cardId, Seeded), ct);
                    }
                });
            }

            // Creating the file stamps it at the current version, so the stamp is wound back to leave
            // the repair as the one step a reopen still has to run.
            await ExecuteAsync(
                "DELETE FROM FlashcardSchemaVersion; INSERT INTO FlashcardSchemaVersion (Version, AppliedAt) VALUES ($v, $at);",
                ("$v", VersionBeforeTheRepair), ("$at", SeededAt));
        }

        public Task RecordProgressAsync(string cardId, int reps, int lapses) =>
            ExecuteAsync(
                "UPDATE FlashcardScheduling SET Reps = $reps, Lapses = $lapses, FsrsState = 2 WHERE CardId = $id;",
                ("$id", cardId), ("$reps", reps), ("$lapses", lapses));

        /// <summary>Runs the store's initialization, which is where the upgrade happens.</summary>
        public async Task OpenAsync()
        {
            await using var store = new FlashcardStore(new TestLogger(), _path, new TestTimeProvider(Opened));
            await store.InitializeAsync();
        }

        public async Task<CardRow> CardAsync(string id)
        {
            foreach (var row in await CardsAsync())
            {
                if (row.Id == id)
                    return row;
            }

            throw new InvalidOperationException($"No card {id}.");
        }

        public async Task<IReadOnlyList<CardRow>> CardsAsync()
        {
            var rows = new List<CardRow>();
            await ReadAsync(
                "SELECT Id, Front, Back, LayoutKey, UpdatedAt FROM FlashcardCards ORDER BY LayoutKey;",
                reader => rows.Add(new CardRow(
                    reader.GetString(0), reader.GetString(1), reader.GetString(2),
                    reader.IsDBNull(3) ? null : reader.GetString(3), reader.GetString(4))));
            return rows;
        }

        public async Task<ScheduleRow> ScheduleAsync(string cardId)
        {
            ScheduleRow? row = null;
            await ReadAsync(
                "SELECT Reps, Lapses FROM FlashcardScheduling WHERE CardId = $id;",
                reader => row = new ScheduleRow(reader.GetInt32(0), reader.GetInt32(1)),
                ("$id", cardId));
            return row ?? throw new InvalidOperationException($"No schedule for {cardId}.");
        }

        public async Task<bool> HasScheduleAsync(string cardId)
        {
            var found = false;
            await ReadAsync(
                "SELECT 1 FROM FlashcardScheduling WHERE CardId = $id;",
                _ => found = true,
                ("$id", cardId));
            return found;
        }

        private async Task ExecuteAsync(string sql, params (string Name, object Value)[] parameters)
        {
            await using var conn = new SqliteConnection($"Data Source={_path}");
            await conn.OpenAsync();
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = sql;
            foreach (var (name, value) in parameters)
                cmd.Parameters.AddWithValue(name, value);
            await cmd.ExecuteNonQueryAsync();
        }

        private async Task ReadAsync(string sql, Action<SqliteDataReader> read, params (string Name, object Value)[] parameters)
        {
            await using var conn = new SqliteConnection($"Data Source={_path}");
            await conn.OpenAsync();
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = sql;
            foreach (var (name, value) in parameters)
                cmd.Parameters.AddWithValue(name, value);
            await using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
                read(reader);
        }

        public ValueTask DisposeAsync()
        {
            foreach (var suffix in new[] { "", "-wal", "-shm" })
            {
                try { File.Delete(_path + suffix); }
                catch { /* best effort */ }
            }

            return ValueTask.CompletedTask;
        }
    }
}
