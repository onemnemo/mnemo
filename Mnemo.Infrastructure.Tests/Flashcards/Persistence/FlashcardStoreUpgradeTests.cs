using System;
using System.IO;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards.Persistence;
using Mnemo.Infrastructure.Tests.Widgets;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Flashcards.Persistence;

/// <summary>
/// Opening a database written by an older build.
/// </summary>
/// <remarks>
/// The schema is created with CREATE TABLE IF NOT EXISTS, which does nothing at all to a
/// table that is already there. A column added later therefore reaches new installs and
/// no existing one, and the failure is not a crash at startup but every deck in the
/// library reading back without it.
/// </remarks>
public sealed class FlashcardStoreUpgradeTests
{
    [Fact]
    public async Task Opening_a_v1_database_adds_the_columns_it_predates()
    {
        var path = Path.Combine(Path.GetTempPath(), $"mnemo_fc_v1_{Guid.NewGuid():N}.db");
        try
        {
            await WriteVersionOneAsync(path);

            await using (var store = new FlashcardStore(new TestLogger(), path))
            {
                await store.InitializeAsync();

                foreach (var (table, column, _) in FlashcardStoreSchema.AddedColumns)
                    Assert.True(
                        await ColumnExistsAsync(store, table, column),
                        $"{table}.{column} is missing after opening a v1 database.");
            }
        }
        finally
        {
            Delete(path);
        }
    }

    [Fact]
    public async Task A_deck_saved_before_icons_reads_back_without_one_and_can_be_given_one()
    {
        var path = Path.Combine(Path.GetTempPath(), $"mnemo_fc_v1_{Guid.NewGuid():N}.db");
        try
        {
            await WriteVersionOneAsync(path);
            await InsertVersionOneDeckAsync(path, "deck-1", "Antiarrhythmics");

            var decks = new DeckRepository();
            await using var store = new FlashcardStore(new TestLogger(), path);
            await store.InitializeAsync();

            var before = await store.ReadAsync((conn, ct) => decks.GetHeaderAsync(conn, "deck-1", ct));
            Assert.NotNull(before);
            Assert.Equal("Antiarrhythmics", before!.Name);
            Assert.Null(before.Icon);

            await store.WriteAsync((conn, tx, ct) => decks.UpsertAsync(conn, tx, before with { Icon = "pill" }, ct));

            var after = await store.ReadAsync((conn, ct) => decks.GetHeaderAsync(conn, "deck-1", ct));
            Assert.Equal("pill", after!.Icon);
        }
        finally
        {
            Delete(path);
        }
    }

    [Fact]
    public async Task A_preset_saved_before_the_scheduling_columns_reads_back_with_their_defaults()
    {
        var path = Path.Combine(Path.GetTempPath(), $"mnemo_fc_v1_{Guid.NewGuid():N}.db");
        try
        {
            await WriteVersionOneAsync(path);
            await InsertVersionOneDeckAsync(path, "deck-1", "Antiarrhythmics");

            var presets = new PresetRepository();
            await using var store = new FlashcardStore(new TestLogger(), path);
            await store.InitializeAsync();

            // Each column arrives with a default rather than a null, so a collection that predates
            // the setting keeps the day it always had instead of quietly moving to midnight, and
            // gets the same lapse handling a fresh install would.
            var before = await store.ReadAsync((conn, ct) => presets.GetAsync(conn, FlashcardPreset.StandardPresetId, ct));
            Assert.NotNull(before);
            Assert.Equal(FlashcardPreset.DefaultNextDayStartsAtHour, before!.NextDayStartsAtHour);
            Assert.Equal(FlashcardPreset.DefaultLeechThreshold, before.LeechThreshold);
            Assert.Equal(FlashcardLeechAction.Tag, before.LeechAction);

            await store.WriteAsync((conn, tx, ct) => presets.UpsertAsync(
                conn, tx, before with { NextDayStartsAtHour = 2, LeechThreshold = 5, LeechAction = FlashcardLeechAction.Suspend }, ct));

            var after = await store.ReadAsync((conn, ct) => presets.GetAsync(conn, FlashcardPreset.StandardPresetId, ct));
            Assert.Equal(2, after!.NextDayStartsAtHour);
            Assert.Equal(5, after.LeechThreshold);
            Assert.Equal(FlashcardLeechAction.Suspend, after.LeechAction);
        }
        finally
        {
            Delete(path);
        }
    }

    [Fact]
    public async Task A_collection_written_before_the_trash_keeps_its_content_and_reads_back_live()
    {
        var path = Path.Combine(Path.GetTempPath(), $"mnemo_fc_v7_{Guid.NewGuid():N}.db");
        try
        {
            await WriteRealCollectionAsync(path, "deck-1", "c1");
            await StripTheTrashAsync(path);

            var decks = new DeckRepository();
            var cards = new CardRepository();
            await using var store = new FlashcardStore(new TestLogger(), path);
            await store.InitializeAsync();

            foreach (var (table, column, _) in FlashcardStoreSchema.AddedColumns)
                Assert.True(
                    await ColumnExistsAsync(store, table, column),
                    $"{table}.{column} is missing after opening a collection written before the trash.");
            Assert.True(await TableExistsAsync(store, "FlashcardTrashFactHomes"));
            Assert.True(await IndexExistsAsync(store, "IX_Cards_Trash"));

            // Nothing in an existing collection was ever deleted, so every row has to come back as
            // something the library can still see rather than something held out of it.
            var deck = await store.ReadAsync((conn, ct) => decks.GetHeaderAsync(conn, "deck-1", ct));
            Assert.NotNull(deck);
            var card = await store.ReadAsync((conn, ct) => cards.GetAsync(conn, "c1", ct));
            Assert.NotNull(card);
            Assert.Equal("Q", card!.Front);
        }
        finally
        {
            Delete(path);
        }
    }

    [Fact]
    public async Task A_collection_written_before_the_origin_marker_reads_its_reviews_back_as_answered_here()
    {
        var path = Path.Combine(Path.GetTempPath(), $"mnemo_fc_v8_{Guid.NewGuid():N}.db");
        try
        {
            await WriteRealCollectionAsync(path, "deck-1", "c1");
            await AddReviewAsync(path, "deck-1", "c1");
            await StripTheOriginAsync(path);

            var reviews = new ReviewRepository();
            await using var store = new FlashcardStore(new TestLogger(), path);
            await store.InitializeAsync();

            Assert.True(
                await ColumnExistsAsync(store, "FlashcardReviews", "Origin"),
                "FlashcardReviews.Origin is missing after opening a collection written before it.");

            // A review already in the file was answered here, which is what the column's default
            // says, so no backfill is needed and none is done. Reading one back as imported would
            // put somebody's own study under another app's name.
            var review = Assert.Single(await store.ReadAsync((conn, ct) => reviews.ListForCardsAsync(conn, ["c1"], ct)));
            Assert.Equal(FlashcardReviewOrigin.Studied, review.Origin);
            Assert.Equal(FlashcardReviewGrade.Good, review.Grade);
        }
        finally
        {
            Delete(path);
        }
    }

    [Fact]
    public async Task Material_left_naming_a_deck_that_is_gone_is_refiled_where_its_cards_are()
    {
        var path = Path.Combine(Path.GetTempPath(), $"mnemo_fc_v8_{Guid.NewGuid():N}.db");
        try
        {
            await WriteRealCollectionAsync(path, "deck-1", "c1");
            await AddSecondDeckAsync(path, "deck-2");
            // A profile written before deck deletion refiled its material: the fact still names the
            // deck that was deleted, while the card it makes was moved somewhere else and survived.
            await AddFactAsync(path, "fact-1", factDeckId: "deck-gone", cardId: "c1", cardDeckId: "deck-2");
            await SetVersionAsync(path, 8);

            var facts = new FactRepository();
            await using var store = new FlashcardStore(new TestLogger(), path);
            await store.InitializeAsync();

            var fact = await store.ReadAsync((conn, ct) => facts.GetAsync(conn, "fact-1", ct));
            Assert.NotNull(fact);
            Assert.Equal("deck-2", fact!.DeckId);
        }
        finally
        {
            Delete(path);
        }
    }

    [Fact]
    public async Task Material_with_no_cards_left_keeps_the_deck_it_names_rather_than_being_guessed_at()
    {
        var path = Path.Combine(Path.GetTempPath(), $"mnemo_fc_v8_{Guid.NewGuid():N}.db");
        try
        {
            await WriteRealCollectionAsync(path, "deck-1", "c1");
            await AddFactAsync(path, "fact-1", factDeckId: "deck-gone", cardId: null, cardDeckId: null);
            await SetVersionAsync(path, 8);

            var facts = new FactRepository();
            await using var store = new FlashcardStore(new TestLogger(), path);
            await store.InitializeAsync();

            // There is nothing to point it at. A row that is honestly stranded is better than one
            // filed somewhere nobody chose.
            var fact = await store.ReadAsync((conn, ct) => facts.GetAsync(conn, "fact-1", ct));
            Assert.NotNull(fact);
            Assert.Equal("deck-gone", fact!.DeckId);
        }
        finally
        {
            Delete(path);
        }
    }

    /// <summary>Writes a collection with the current build, so the file has the full real shape.</summary>
    /// <remarks>Internal rather than private: <see cref="FlashcardStoreVersionMatrixTests"/> composes
    /// with this rather than rebuilding its own copy of a real collection.</remarks>
    internal static async Task WriteRealCollectionAsync(string path, string deckId, string cardId)
    {
        var now = DateTimeOffset.UtcNow;
        await using var store = new FlashcardStore(new TestLogger(), path);
        await store.InitializeAsync();
        await store.WriteAsync(async (conn, tx, ct) =>
        {
            await new PresetRepository().UpsertAsync(conn, tx, FlashcardPreset.CreateStandard(now), ct);
            await new DeckRepository().UpsertAsync(conn, tx, new FlashcardDeckHeader(
                deckId, null, FlashcardPreset.StandardPresetId, "Deck", null, Array.Empty<string>(),
                0, null, null, now, now), ct);
            await new CardRepository().InsertAsync(conn, tx, new Flashcard(
                cardId, deckId, FlashcardType.Classic, "Q", "A", Array.Empty<string>(),
                FlashcardCardState.Active, false, Array.Empty<FlashcardAttachment>(), null, null, null, now, now), ct);
        });
    }

    private static async Task AddSecondDeckAsync(string path, string deckId)
    {
        var now = DateTimeOffset.UtcNow;
        await using var store = new FlashcardStore(new TestLogger(), path);
        await store.InitializeAsync();
        await store.WriteAsync((conn, tx, ct) => new DeckRepository().UpsertAsync(conn, tx, new FlashcardDeckHeader(
            deckId, null, FlashcardPreset.StandardPresetId, "Other", null, Array.Empty<string>(),
            0, null, null, now, now), ct));
    }

    private static async Task AddReviewAsync(string path, string deckId, string cardId)
    {
        await using var store = new FlashcardStore(new TestLogger(), path);
        await store.InitializeAsync();
        await store.WriteAsync((conn, tx, ct) => new ReviewRepository().AppendAsync(conn, tx, new FlashcardReviewLog(
            FlashcardReviewLog.Unassigned, cardId, deckId, "s1", FlashcardReviewGrade.Good,
            DateTimeOffset.UtcNow.AddDays(-1), 1, 3, null, null,
            FlashcardFsrsState.Review, FlashcardFsrsState.Review), ct));
    }

    /// <summary>
    /// Attaches a fact to the collection, optionally handing an existing card to it, so a database
    /// carrying the shape an older deck delete left behind can be built by hand.
    /// </summary>
    private static async Task AddFactAsync(string path, string factId, string factDeckId, string? cardId, string? cardDeckId)
    {
        var stamp = DateTimeOffset.UtcNow.ToString("O");
        SqliteConnection.ClearAllPools();
        await using var conn = new SqliteConnection($"Data Source={path}");
        await conn.OpenAsync();

        await using (var fact = conn.CreateCommand())
        {
            fact.CommandText = """
                INSERT INTO FlashcardFacts (Id, DeckId, TypeId, ValuesJson, MediaJson, TagsJson, IsFlagged, CreatedAt, UpdatedAt)
                VALUES ($id, $deck, 'basic', '{}', '{}', '[]', 0, $at, $at);
                """;
            fact.Parameters.AddWithValue("$id", factId);
            fact.Parameters.AddWithValue("$deck", factDeckId);
            fact.Parameters.AddWithValue("$at", stamp);
            await fact.ExecuteNonQueryAsync();
        }

        if (cardId is null || cardDeckId is null)
            return;

        await using var card = conn.CreateCommand();
        card.CommandText = "UPDATE FlashcardCards SET FactId = $fact, LayoutKey = 'recognition', DeckId = $deck WHERE Id = $id;";
        card.Parameters.AddWithValue("$fact", factId);
        card.Parameters.AddWithValue("$deck", cardDeckId);
        card.Parameters.AddWithValue("$id", cardId);
        await card.ExecuteNonQueryAsync();
    }

    /// <summary>
    /// Takes the file back to what the build before the origin marker left behind: the column is
    /// removed and the stamp is moved back, so reopening has real work to do.
    /// </summary>
    private static async Task StripTheOriginAsync(string path)
    {
        SqliteConnection.ClearAllPools();
        await using var conn = new SqliteConnection($"Data Source={path}");
        await conn.OpenAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            ALTER TABLE FlashcardReviews DROP COLUMN Origin;
            UPDATE FlashcardSchemaVersion SET Version = 8;
            """;
        await cmd.ExecuteNonQueryAsync();
    }

    internal static async Task SetVersionAsync(string path, int version)
    {
        SqliteConnection.ClearAllPools();
        await using var conn = new SqliteConnection($"Data Source={path}");
        await conn.OpenAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "UPDATE FlashcardSchemaVersion SET Version = $v;";
        cmd.Parameters.AddWithValue("$v", version);
        await cmd.ExecuteNonQueryAsync();
    }

    /// <summary>
    /// Takes the file back to what the build before the trash left behind: the columns, indexes and
    /// table the trash added are removed and the stamp is moved back, so reopening has real work to do.
    /// </summary>
    private static async Task StripTheTrashAsync(string path)
    {
        SqliteConnection.ClearAllPools();
        await using var conn = new SqliteConnection($"Data Source={path}");
        await conn.OpenAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            DROP INDEX IF EXISTS IX_Folders_Trash;
            DROP INDEX IF EXISTS IX_Decks_Trash;
            DROP INDEX IF EXISTS IX_Facts_Trash;
            DROP INDEX IF EXISTS IX_Cards_Trash;
            DROP INDEX IF EXISTS IX_Cards_Live_Deck;
            DROP INDEX IF EXISTS IX_Facts_Live_Deck;
            DROP TABLE IF EXISTS FlashcardTrashFactHomes;
            ALTER TABLE FlashcardFolders DROP COLUMN TrashId;
            ALTER TABLE FlashcardDecks   DROP COLUMN TrashId;
            ALTER TABLE FlashcardFacts   DROP COLUMN TrashId;
            ALTER TABLE FlashcardCards   DROP COLUMN TrashId;
            UPDATE FlashcardSchemaVersion SET Version = 7;
            """;
        await cmd.ExecuteNonQueryAsync();
    }

    /// <summary>
    /// The v1 shape, written by hand: the decks table without Icon, plus the version stamp
    /// that stops a plain version check from doing any work.
    /// </summary>
    private static async Task WriteVersionOneAsync(string path)
    {
        await using var conn = new SqliteConnection($"Data Source={path}");
        await conn.OpenAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            CREATE TABLE FlashcardSchemaVersion (Version INTEGER PRIMARY KEY, AppliedAt TEXT NOT NULL);
            CREATE TABLE FlashcardPresets (
                Id TEXT PRIMARY KEY, Name TEXT NOT NULL, NewPerDay INTEGER NOT NULL DEFAULT 20,
                MaxReviewsPerDay INTEGER NOT NULL DEFAULT 200, Algorithm INTEGER NOT NULL DEFAULT 1,
                DesiredRetention REAL NOT NULL DEFAULT 0.9, LearningStepsJson TEXT NOT NULL DEFAULT '[1,10]',
                RelearnStepsJson TEXT NOT NULL DEFAULT '[10]', ShuffleOrder INTEGER NOT NULL DEFAULT 0,
                BuryRelated INTEGER NOT NULL DEFAULT 1, AutoReveal TEXT NOT NULL DEFAULT 'off',
                WeightsJson TEXT NULL, CreatedAt TEXT NOT NULL, UpdatedAt TEXT NOT NULL);
            CREATE TABLE FlashcardDecks (
                Id TEXT PRIMARY KEY, FolderId TEXT NULL, PresetId TEXT NOT NULL,
                Name TEXT NOT NULL, Description TEXT NULL, TagsJson TEXT NOT NULL DEFAULT '[]',
                SortOrder INTEGER NOT NULL DEFAULT 0, LastStudied TEXT NULL,
                CreatedAt TEXT NOT NULL, UpdatedAt TEXT NOT NULL);
            INSERT INTO FlashcardSchemaVersion (Version, AppliedAt) VALUES (1, '2026-01-01T00:00:00.0000000+00:00');
            """;
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task InsertVersionOneDeckAsync(string path, string deckId, string name)
    {
        var stamp = DateTimeOffset.UtcNow.ToString("O");
        await using var conn = new SqliteConnection($"Data Source={path}");
        await conn.OpenAsync();

        await using var preset = conn.CreateCommand();
        preset.CommandText = """
            INSERT INTO FlashcardPresets (Id, Name, CreatedAt, UpdatedAt)
            VALUES ($id, 'Standard', $at, $at);
            """;
        preset.Parameters.AddWithValue("$id", FlashcardPreset.StandardPresetId);
        preset.Parameters.AddWithValue("$at", stamp);
        await preset.ExecuteNonQueryAsync();

        await using var deck = conn.CreateCommand();
        deck.CommandText = """
            INSERT INTO FlashcardDecks (Id, FolderId, PresetId, Name, Description, TagsJson, SortOrder, LastStudied, CreatedAt, UpdatedAt)
            VALUES ($id, NULL, $preset, $name, NULL, '[]', 0, NULL, $at, $at);
            """;
        deck.Parameters.AddWithValue("$id", deckId);
        deck.Parameters.AddWithValue("$preset", FlashcardPreset.StandardPresetId);
        deck.Parameters.AddWithValue("$name", name);
        deck.Parameters.AddWithValue("$at", stamp);
        await deck.ExecuteNonQueryAsync();
    }

    internal static Task<bool> ColumnExistsAsync(FlashcardStore store, string table, string column) =>
        store.ReadAsync(async (conn, ct) =>
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = $"SELECT 1 FROM pragma_table_info('{table}') WHERE name = $column LIMIT 1;";
            cmd.Parameters.AddWithValue("$column", column);
            return await cmd.ExecuteScalarAsync(ct) is not null;
        });

    private static Task<bool> TableExistsAsync(FlashcardStore store, string table) =>
        ExistsInMasterAsync(store, "table", table);

    private static Task<bool> IndexExistsAsync(FlashcardStore store, string index) =>
        ExistsInMasterAsync(store, "index", index);

    private static Task<bool> ExistsInMasterAsync(FlashcardStore store, string type, string name) =>
        store.ReadAsync(async (conn, ct) =>
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT 1 FROM sqlite_master WHERE type = $type AND name = $name LIMIT 1;";
            cmd.Parameters.AddWithValue("$type", type);
            cmd.Parameters.AddWithValue("$name", name);
            return await cmd.ExecuteScalarAsync(ct) is not null;
        });

    internal static void Delete(string path)
    {
        SqliteConnection.ClearAllPools();
        foreach (var file in new[] { path, path + "-wal", path + "-shm" })
        {
            try
            {
                if (File.Exists(file))
                    File.Delete(file);
            }
            catch (IOException)
            {
                // A leftover temp file is not worth failing a green run over.
            }
        }
    }
}
