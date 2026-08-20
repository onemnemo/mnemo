using System;
using System.Collections.Generic;
using System.IO;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Mnemo.Infrastructure.Services.Flashcards.Persistence;
using Mnemo.Infrastructure.Tests.Widgets;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Flashcards.Persistence;

/// <summary>
/// Every schema version from 1 through <see cref="FlashcardStoreSchema.TargetVersion"/> (10), opened
/// from a real per-version fixture and checked against a column list this file owns rather than
/// reads from production.
/// </summary>
/// <remarks>
/// <para>
/// Composes with <see cref="FlashcardStoreUpgradeTests"/> rather than duplicating it: the real
/// fixture builder and the file-existence helpers are shared from there, and that file's own tests
/// keep the deeper behavioural coverage for the trash (v8) and origin (v9) steps, and
/// <see cref="FlashcardFactMigrationTests"/> keeps the deep coverage of what the v6 fact backfill
/// does to a card's actual content (cloze splitting, media, tags). What this file adds is breadth:
/// every version gets its own fixture built by stripping the exact columns, tables and indexes a
/// later step is known to add from a real v9 collection (a reversal of the git history each step
/// landed in, not a copy of <see cref="FlashcardStoreSchema.AddedColumns"/>), and every fixture is
/// checked against a hardcoded expectation of the current schema.
/// </para>
/// <para>
/// The hardcoded expectation is the point. A test that asks "does every column in
/// <see cref="FlashcardStoreSchema.AddedColumns"/> exist" cannot catch an entry being deleted from
/// that same list, because the checklist shrinks with it. This file's <see cref="ExpectedColumns"/>
/// is written independently, so removing a production step leaves this file expecting a column (or
/// the v6 fact backfill's effect) that the run under test no longer has, and the assertion fails for
/// real rather than vacuously.
/// </para>
/// </remarks>
public sealed class FlashcardStoreVersionMatrixTests
{
    /// <summary>
    /// Every column <see cref="FlashcardStoreSchema.AddedColumns"/> is responsible for, kept here
    /// independently of that list so a deleted entry there cannot also delete the expectation of it
    /// here. Table names match <see cref="FlashcardStoreSchema.CreateSql"/>.
    /// </summary>
    private static readonly (string Table, string Column)[] ExpectedColumns =
    [
        ("FlashcardDecks", "Icon"),
        ("FlashcardReviews", "StateBefore"),
        ("FlashcardPresets", "NextDayStartsAtHour"),
        ("FlashcardPresets", "LeechThreshold"),
        ("FlashcardPresets", "LeechAction"),
        ("FlashcardCards", "FactId"),
        ("FlashcardCards", "LayoutKey"),
        ("FlashcardScheduling", "BuriedUntil"),
        ("FlashcardFolders", "TrashId"),
        ("FlashcardDecks", "TrashId"),
        ("FlashcardFacts", "TrashId"),
        ("FlashcardCards", "TrashId"),
        ("FlashcardReviews", "Origin"),
    ];

    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    [InlineData(3)]
    [InlineData(4)]
    [InlineData(5)]
    [InlineData(6)]
    [InlineData(7)]
    [InlineData(8)]
    [InlineData(9)]
    [InlineData(10)]
    public async Task Opening_a_database_from_any_version_reaches_current_with_every_column_present(int fromVersion)
    {
        var path = Path.Combine(Path.GetTempPath(), $"mnemo_fc_matrix_v{fromVersion}_{Guid.NewGuid():N}.db");
        try
        {
            await WriteAtVersionAsync(path, fromVersion, "deck-1", "card-1");

            var decks = new DeckRepository();
            var cards = new CardRepository();
            await using var store = new FlashcardStore(new TestLogger(), path);
            await store.InitializeAsync();

            Assert.Equal(FlashcardStoreSchema.TargetVersion, await ReadStoredVersionAsync(path));

            foreach (var (table, column) in ExpectedColumns)
                Assert.True(
                    await FlashcardStoreUpgradeTests.ColumnExistsAsync(store, table, column),
                    $"{table}.{column} is missing after opening a v{fromVersion} database.");

            Assert.True(
                await FlashcardStoreUpgradeTests.IndexExistsAsync(store, "IX_Decks_Live"),
                $"IX_Decks_Live is missing after opening a v{fromVersion} database.");
            Assert.True(
                await FlashcardStoreUpgradeTests.IndexExistsAsync(store, "IX_Folders_Live"),
                $"IX_Folders_Live is missing after opening a v{fromVersion} database.");

            // The fixture's own content survived the round trip rather than being lost by a strip
            // step reaching further than the column or table it was meant to remove.
            var deck = await store.ReadAsync((conn, ct) => decks.GetHeaderAsync(conn, "deck-1", ct));
            Assert.NotNull(deck);
            var card = await store.ReadAsync((conn, ct) => cards.GetAsync(conn, "card-1", ct));
            Assert.NotNull(card);
            Assert.Equal("Q", card!.Front);

            if (fromVersion < 6)
            {
                // Crossed the v6 fact backfill threshold: the card written with no fact (this
                // fixture predates card types) must have gained the basic one it was implicitly
                // holding, not merely a column that stayed null.
                Assert.NotNull(card.FactId);
                var fact = await store.ReadAsync((conn, ct) => new FactRepository().GetAsync(conn, card.FactId!, ct));
                Assert.NotNull(fact);
                Assert.Equal("basic", fact!.TypeId);
            }
        }
        finally
        {
            FlashcardStoreUpgradeTests.Delete(path);
        }
    }

    /// <summary>
    /// Builds a real v9 collection through the current build, then strips exactly what each later
    /// version is known (from the commit that introduced it) to have added, stopping at
    /// <paramref name="targetVersion"/>. Reversing forward is what keeps every fixture honest: the
    /// content is real repository output, and only the schema is walked backward.
    /// </summary>
    private static async Task WriteAtVersionAsync(string path, int targetVersion, string deckId, string cardId)
    {
        await FlashcardStoreUpgradeTests.WriteRealCollectionAsync(path, deckId, cardId);

        if (targetVersion < 10) await StripLiveIndexesAsync(path);
        if (targetVersion < 9) await StripOriginAsync(path);
        if (targetVersion < 8) await StripTrashAsync(path);
        if (targetVersion < 7) await StripBuriedUntilAsync(path);
        if (targetVersion < 6) await StripFactsAsync(path);
        if (targetVersion < 5) await StripLeechAsync(path);
        if (targetVersion < 4) await StripNextDayStartAsync(path);
        if (targetVersion < 3) await StripStateBeforeAsync(path);
        if (targetVersion < 2) await StripIconAsync(path);

        await FlashcardStoreUpgradeTests.SetVersionAsync(path, targetVersion);
    }

    // --- Strip steps, one per version transition, applied high to low. ---
    // Each removes exactly what the commit introducing that version added to
    // FlashcardStoreSchema (verified against git history), nothing more.

    /// <summary>v10 added IX_Decks_Live and IX_Folders_Live.</summary>
    private static Task StripLiveIndexesAsync(string path) =>
        ExecuteAsync(
            path,
            """
            DROP INDEX IF EXISTS IX_Decks_Live;
            DROP INDEX IF EXISTS IX_Folders_Live;
            """);

    /// <summary>v9 added FlashcardReviews.Origin.</summary>
    private static Task StripOriginAsync(string path) =>
        ExecuteAsync(path, "ALTER TABLE FlashcardReviews DROP COLUMN Origin;");

    /// <summary>
    /// v8 added TrashId to four tables, the FlashcardTrashFactHomes table and six indexes. Dropping
    /// FlashcardTrashFactHomes takes its own indexes with it; the rest are dropped explicitly.
    /// IX_Decks_Live and IX_Folders_Live are the later v10 addition, not part of what v8 added, but
    /// they index TrashId too, so they come out here as well: SQLite refuses to drop a column that
    /// an index still references, and by the time this runs StripLiveIndexesAsync has usually
    /// already removed them, so this is a defensive repeat rather than the only place it happens.
    /// </summary>
    private static Task StripTrashAsync(string path) =>
        ExecuteAsync(
            path,
            """
            DROP INDEX IF EXISTS IX_Folders_Trash;
            DROP INDEX IF EXISTS IX_Decks_Trash;
            DROP INDEX IF EXISTS IX_Facts_Trash;
            DROP INDEX IF EXISTS IX_Cards_Trash;
            DROP INDEX IF EXISTS IX_Cards_Live_Deck;
            DROP INDEX IF EXISTS IX_Facts_Live_Deck;
            DROP INDEX IF EXISTS IX_Decks_Live;
            DROP INDEX IF EXISTS IX_Folders_Live;
            DROP TABLE IF EXISTS FlashcardTrashFactHomes;
            ALTER TABLE FlashcardFolders DROP COLUMN TrashId;
            ALTER TABLE FlashcardDecks   DROP COLUMN TrashId;
            ALTER TABLE FlashcardFacts   DROP COLUMN TrashId;
            ALTER TABLE FlashcardCards   DROP COLUMN TrashId;
            """);

    /// <summary>
    /// v7 added FlashcardScheduling.BuriedUntil. A plain ALTER TABLE DROP COLUMN cannot remove it:
    /// SQLite rewrites the table's stored SQL text on drop, and BuriedUntil is both the last column
    /// and immediately preceded by its own comment in FlashcardStoreSchema's source text, which
    /// leaves the rewrite unparseable ("incomplete input"). This is the exact hazard the schema's
    /// own comment on the Origin column warns about; BuriedUntil predates that lesson. Rebuilding
    /// the table under a real DDL statement sidesteps the rewriter instead of fighting it.
    /// </summary>
    private static Task StripBuriedUntilAsync(string path) =>
        ExecuteAsync(
            path,
            """
            CREATE TABLE FlashcardScheduling_v6 (
                CardId            TEXT PRIMARY KEY REFERENCES FlashcardCards(Id) ON DELETE CASCADE,
                DueDate           TEXT NOT NULL,
                Stability         REAL NULL,
                Difficulty        REAL NULL,
                Reps              INTEGER NOT NULL DEFAULT 0,
                Lapses            INTEGER NOT NULL DEFAULT 0,
                FsrsState         INTEGER NOT NULL DEFAULT 0,
                LearningStepIndex INTEGER NOT NULL DEFAULT 0,
                LastReviewedAt    TEXT NULL
            );
            INSERT INTO FlashcardScheduling_v6
                SELECT CardId, DueDate, Stability, Difficulty, Reps, Lapses, FsrsState, LearningStepIndex, LastReviewedAt
                FROM FlashcardScheduling;
            DROP TABLE FlashcardScheduling;
            ALTER TABLE FlashcardScheduling_v6 RENAME TO FlashcardScheduling;
            """);

    /// <summary>
    /// v6 added FlashcardCards.FactId/LayoutKey, their two indexes, and the FlashcardFacts and
    /// FlashcardCardTypes tables. Dropping the tables takes their own indexes with them; opening the
    /// stripped file recreates both tables empty through CREATE TABLE IF NOT EXISTS, then the v6
    /// backfill step repopulates them, which is exactly the case this file exists to prove.
    /// </summary>
    private static Task StripFactsAsync(string path) =>
        ExecuteAsync(
            path,
            """
            DROP INDEX IF EXISTS UX_Cards_Fact_Layout;
            DROP INDEX IF EXISTS IX_Cards_Fact;
            ALTER TABLE FlashcardCards DROP COLUMN FactId;
            ALTER TABLE FlashcardCards DROP COLUMN LayoutKey;
            DROP TABLE IF EXISTS FlashcardFacts;
            DROP TABLE IF EXISTS FlashcardCardTypes;
            """);

    /// <summary>v5 added FlashcardPresets.LeechThreshold and LeechAction.</summary>
    private static Task StripLeechAsync(string path) =>
        ExecuteAsync(
            path,
            """
            ALTER TABLE FlashcardPresets DROP COLUMN LeechThreshold;
            ALTER TABLE FlashcardPresets DROP COLUMN LeechAction;
            """);

    /// <summary>v4 added FlashcardPresets.NextDayStartsAtHour.</summary>
    private static Task StripNextDayStartAsync(string path) =>
        ExecuteAsync(path, "ALTER TABLE FlashcardPresets DROP COLUMN NextDayStartsAtHour;");

    /// <summary>
    /// v3 added FlashcardReviews.StateBefore. Same hazard as <see cref="StripBuriedUntilAsync"/>:
    /// StateBefore is immediately preceded by its own comment in the schema source, and SQLite's
    /// DROP COLUMN rewrite of that stored text comes back unparseable regardless of whether the
    /// column is last. Rebuilt under real DDL instead. By this point in the chain Origin has
    /// already been stripped, so the rebuild's column list already excludes it.
    /// </summary>
    private static Task StripStateBeforeAsync(string path) =>
        ExecuteAsync(
            path,
            """
            CREATE TABLE FlashcardReviews_v2 (
                Id              INTEGER PRIMARY KEY AUTOINCREMENT,
                CardId          TEXT NOT NULL,
                DeckId          TEXT NOT NULL,
                SessionId       TEXT NOT NULL,
                Grade           INTEGER NOT NULL,
                ReviewedAt      TEXT NOT NULL,
                ElapsedDays     REAL NOT NULL,
                ScheduledDays   REAL NOT NULL,
                StabilityAfter  REAL NULL,
                DifficultyAfter REAL NULL,
                StateAfter      INTEGER NOT NULL
            );
            INSERT INTO FlashcardReviews_v2
                SELECT Id, CardId, DeckId, SessionId, Grade, ReviewedAt, ElapsedDays, ScheduledDays,
                       StabilityAfter, DifficultyAfter, StateAfter
                FROM FlashcardReviews;
            DROP TABLE FlashcardReviews;
            ALTER TABLE FlashcardReviews_v2 RENAME TO FlashcardReviews;
            """);

    /// <summary>v2 added FlashcardDecks.Icon.</summary>
    private static Task StripIconAsync(string path) =>
        ExecuteAsync(path, "ALTER TABLE FlashcardDecks DROP COLUMN Icon;");

    private static async Task ExecuteAsync(string path, string sql)
    {
        SqliteTestPools.ClearPoolFor(path);
        await using var conn = new SqliteConnection($"Data Source={path}");
        await conn.OpenAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task<int> ReadStoredVersionAsync(string path)
    {
        SqliteTestPools.ClearPoolFor(path);
        await using var conn = new SqliteConnection($"Data Source={path}");
        await conn.OpenAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT MAX(Version) FROM FlashcardSchemaVersion;";
        return Convert.ToInt32(await cmd.ExecuteScalarAsync());
    }
}
