using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards.Persistence;
using Mnemo.Infrastructure.Tests.Widgets;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Flashcards.Persistence;

/// <summary>
/// Opening a collection written before cards came from facts.
/// </summary>
/// <remarks>
/// Everything here runs against a database written by hand in the older shape, because the only
/// interesting question is what happens to content this build did not create. The cloze cases
/// matter most: a card that held several deletions becomes several cards, and exactly one of them
/// is allowed to inherit the review history there is only one of.
/// </remarks>
public sealed class FlashcardFactMigrationTests
{
    private static readonly DateTimeOffset Now = new(2026, 3, 4, 9, 0, 0, TimeSpan.Zero);

    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    [InlineData(3)]
    [InlineData(4)]
    [InlineData(5)]
    public async Task A_card_from_any_earlier_version_gets_the_fact_it_was_always_holding(int from)
    {
        await using var db = new LegacyDatabase(from);
        await db.AddCardAsync("card-1", FlashcardType.Classic, "Amiodarone", "Class III");

        await db.OpenAsync();

        var card = await db.CardAsync("card-1");
        Assert.Equal("Amiodarone", card.Front);
        Assert.Equal("Class III", card.Back);
        Assert.Equal(FlashcardCardType.RecognitionLayoutId, card.LayoutKey);

        var fact = await db.FactAsync(card.FactId!);
        Assert.Equal(FlashcardCardType.BasicId, fact.TypeId);
        Assert.Equal("deck-1", fact.DeckId);
        Assert.Equal("Amiodarone", fact.Values[FlashcardCardType.BasicFrontFieldId]);
        Assert.Equal("Class III", fact.Values[FlashcardCardType.BasicBackFieldId]);
    }

    [Fact]
    public async Task A_card_keeps_its_tags_its_flag_and_the_source_it_came_from()
    {
        await using var db = new LegacyDatabase(5);
        await db.AddCardAsync(
            "card-1", FlashcardType.Classic, "Amiodarone", "Class III",
            tagsJson: """["pharm","exam"]""", isFlagged: true,
            sourceType: "note", sourceId: "note-9", sourceLabel: "Antiarrhythmics");

        await db.OpenAsync();

        var fact = await db.FactAsync((await db.CardAsync("card-1")).FactId!);
        Assert.Equal("""["pharm","exam"]""", fact.TagsJson);
        Assert.True(fact.IsFlagged);
        Assert.Equal("note", fact.SourceType);
        Assert.Equal("note-9", fact.SourceId);
        Assert.Equal("Antiarrhythmics", fact.SourceLabel);
    }

    [Fact]
    public async Task A_cloze_card_becomes_one_card_per_deletion()
    {
        await using var db = new LegacyDatabase(5);
        await db.AddCardAsync(
            "card-1", FlashcardType.Cloze,
            "{{c1::Amiodarone}} is a class {{c2::III}} antiarrhythmic.",
            "Blocks potassium channels.");

        await db.OpenAsync();

        var cards = await db.CardsInDeckAsync();
        Assert.Equal(2, cards.Count);

        var first = cards.Single(c => c.LayoutKey == "c1");
        Assert.Equal("[…] is a class III antiarrhythmic.", first.Front);
        Assert.Equal(
            "Amiodarone is a class III antiarrhythmic.\n\nBlocks potassium channels.",
            first.Back);

        var second = cards.Single(c => c.LayoutKey == "c2");
        Assert.Equal("Amiodarone is a class […] antiarrhythmic.", second.Front);

        // Both come from the same material, and the material keeps the markers so editing it
        // still works.
        Assert.Equal(first.FactId, second.FactId);
        var fact = await db.FactAsync(first.FactId!);
        Assert.Equal(FlashcardCardType.ClozeId, fact.TypeId);
        Assert.Equal(
            "{{c1::Amiodarone}} is a class {{c2::III}} antiarrhythmic.",
            fact.Values[FlashcardCardType.ClozeTextFieldId]);
        Assert.Equal("Blocks potassium channels.", fact.Values[FlashcardCardType.ClozeExtraFieldId]);
    }

    [Fact]
    public async Task The_lowest_deletion_keeps_the_row_the_schedule_and_the_history()
    {
        await using var db = new LegacyDatabase(5);
        await db.AddCardAsync("card-1", FlashcardType.Cloze, "{{c2::B}} then {{c1::A}} then {{c3::C}}", string.Empty);
        await db.SetScheduleAsync("card-1", stability: 41.5, difficulty: 5.25, reps: 9, lapses: 2, fsrsState: 2);
        await db.AddReviewAsync("card-1");
        await db.AddReviewAsync("card-1");

        await db.OpenAsync();

        var kept = (await db.CardsInDeckAsync()).Single(c => c.Id == "card-1");
        Assert.Equal("c1", kept.LayoutKey);

        var schedule = await db.ScheduleAsync("card-1");
        Assert.Equal(41.5, schedule.Stability);
        Assert.Equal(5.25, schedule.Difficulty);
        Assert.Equal(9, schedule.Reps);
        Assert.Equal(2, schedule.Lapses);
        Assert.Equal(2, schedule.FsrsState);
        Assert.Equal(2, await db.ReviewCountAsync("card-1"));
    }

    [Fact]
    public async Task The_deletions_that_were_never_answerable_on_their_own_start_new()
    {
        await using var db = new LegacyDatabase(5);
        await db.AddCardAsync("card-1", FlashcardType.Cloze, "{{c1::A}} and {{c2::B}}", string.Empty);
        await db.SetScheduleAsync("card-1", stability: 41.5, difficulty: 5.25, reps: 9, lapses: 2, fsrsState: 2);

        await db.OpenAsync();

        var sibling = (await db.CardsInDeckAsync()).Single(c => c.LayoutKey == "c2");
        Assert.NotEqual("card-1", sibling.Id);

        var schedule = await db.ScheduleAsync(sibling.Id);
        Assert.Equal(0, schedule.FsrsState);
        Assert.Equal(0, schedule.Reps);
        Assert.Equal(0, schedule.Lapses);
        Assert.Null(schedule.Stability);
        Assert.Equal(0, await db.ReviewCountAsync(sibling.Id));
    }

    [Fact]
    public async Task A_suspended_card_stays_suspended_in_every_part_it_turns_out_to_have()
    {
        await using var db = new LegacyDatabase(5);
        await db.AddCardAsync(
            "card-1", FlashcardType.Cloze, "{{c1::A}} and {{c2::B}}", string.Empty,
            state: FlashcardCardState.Suspended, isFlagged: true);

        await db.OpenAsync();

        var cards = await db.CardsInDeckAsync();
        Assert.Equal(2, cards.Count);
        Assert.All(cards, c => Assert.Equal(FlashcardCardState.Suspended, c.State));
        Assert.All(cards, c => Assert.True(c.IsFlagged));
    }

    [Fact]
    public async Task A_cloze_card_with_nothing_to_delete_stays_one_card_instead_of_becoming_none()
    {
        // The importer types a card by the name of the model it came from, so a card can arrive
        // marked cloze with no deletion in it. Generating from that would make zero cards, and an
        // upgrade is not allowed to be the thing that loses one.
        await using var db = new LegacyDatabase(5);
        await db.AddCardAsync("card-1", FlashcardType.Cloze, "Amiodarone", "Class III");

        await db.OpenAsync();

        var cards = await db.CardsInDeckAsync();
        var only = Assert.Single(cards);
        Assert.Equal("card-1", only.Id);
        Assert.Equal("Amiodarone", only.Front);
        Assert.Equal("Class III", only.Back);
        Assert.Equal(FlashcardType.Classic, only.Type);
        Assert.Equal(FlashcardCardType.RecognitionLayoutId, only.LayoutKey);
        Assert.Equal(FlashcardCardType.BasicId, (await db.FactAsync(only.FactId!)).TypeId);
    }

    [Fact]
    public async Task Media_moves_from_the_side_it_hung_off_to_the_field_that_owns_it()
    {
        await using var db = new LegacyDatabase(5);
        await db.AddCardAsync(
            "card-1", FlashcardType.Classic, "What is this?", "An ECG",
            attachmentsJson: """
                [{"Id":"a1","Side":"front","FilePath":"ecg.png","DisplayName":"ecg.png","SizeBytes":120,"Caption":null},
                 {"Id":"a2","Side":"back","FilePath":"note.png","DisplayName":"note.png","SizeBytes":90,"Caption":"lead II"}]
                """);

        await db.OpenAsync();

        var card = await db.CardAsync("card-1");
        var media = JsonNode.Parse((await db.FactAsync(card.FactId!)).MediaJson)!.AsObject();

        var front = media[FlashcardCardType.BasicFrontFieldId]!.AsArray();
        Assert.Equal("a1", front.Single()!["Id"]!.GetValue<string>());
        var back = media[FlashcardCardType.BasicBackFieldId]!.AsArray();
        Assert.Equal("a2", back.Single()!["Id"]!.GetValue<string>());

        // The card still shows what it always showed.
        Assert.Equal(2, JsonNode.Parse(card.AttachmentsJson)!.AsArray().Count);
    }

    [Fact]
    public async Task A_property_on_an_attachment_that_this_build_does_not_know_survives_the_move()
    {
        // A collection can be opened by an older build after a newer one has written to it. Moving
        // media through a typed shape would quietly drop whatever that build had added.
        await using var db = new LegacyDatabase(5);
        await db.AddCardAsync(
            "card-1", FlashcardType.Classic, "Question", "Answer",
            attachmentsJson: """
                [{"Id":"a1","Side":"front","FilePath":"clip.mp3","DisplayName":"clip.mp3","SizeBytes":4096,
                  "Caption":null,"Kind":"audio","DurationMs":1500}]
                """);

        await db.OpenAsync();

        var card = await db.CardAsync("card-1");
        var moved = JsonNode.Parse((await db.FactAsync(card.FactId!)).MediaJson)!
            .AsObject()[FlashcardCardType.BasicFrontFieldId]!
            .AsArray()
            .Single()!
            .AsObject();

        Assert.Equal("audio", moved["Kind"]!.GetValue<string>());
        Assert.Equal(1500, moved["DurationMs"]!.GetValue<int>());
    }

    [Fact]
    public async Task A_card_with_no_media_gets_a_fact_with_no_media()
    {
        await using var db = new LegacyDatabase(5);
        await db.AddCardAsync("card-1", FlashcardType.Classic, "Question", "Answer");

        await db.OpenAsync();

        var fact = await db.FactAsync((await db.CardAsync("card-1")).FactId!);
        Assert.Equal("{}", fact.MediaJson);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("not json")]
    [InlineData("""{"Id":"a1"}""")]
    public async Task A_card_whose_media_column_cannot_be_read_still_lets_the_collection_open(string attachmentsJson)
    {
        // Every runtime read of this column falls back to no attachments rather than throwing,
        // because a row written by a build that no longer exists still has to open. The upgrade
        // has to hold to that too: it runs before anything else can, and a throw here would leave
        // the version unstamped, so the same row would fail the same way on every later launch and
        // take the whole module down with it.
        await using var db = new LegacyDatabase(5);
        await db.AddCardAsync("card-1", FlashcardType.Classic, "Question", "Answer", attachmentsJson: attachmentsJson);
        await db.AddCardAsync("card-2", FlashcardType.Classic, "Second", "Card");

        await db.OpenAsync();

        var broken = await db.CardAsync("card-1");
        Assert.Equal("{}", (await db.FactAsync(broken.FactId!)).MediaJson);
        // The unreadable text is left on the card rather than rewritten, so nothing the upgrade
        // could not read is thrown away.
        Assert.Equal(attachmentsJson, broken.AttachmentsJson);

        // The rest of the collection migrated normally.
        var healthy = await db.CardAsync("card-2");
        Assert.Equal(FlashcardCardType.BasicId, (await db.FactAsync(healthy.FactId!)).TypeId);
    }

    [Fact]
    public async Task The_built_in_card_types_arrive_with_the_upgrade()
    {
        await using var db = new LegacyDatabase(5);

        await db.OpenAsync();

        var ids = await db.CardTypeIdsAsync();
        Assert.Contains(FlashcardCardType.BasicId, ids);
        Assert.Contains(FlashcardCardType.BasicReverseId, ids);
        Assert.Contains(FlashcardCardType.VocabularyId, ids);
        Assert.Contains(FlashcardCardType.ClozeId, ids);
    }

    [Fact]
    public async Task Opening_a_database_that_is_already_migrated_leaves_it_alone()
    {
        await using var db = new LegacyDatabase(5);
        await db.AddCardAsync("card-1", FlashcardType.Cloze, "{{c1::A}} and {{c2::B}}", string.Empty);

        await db.OpenAsync();
        var afterFirst = await db.CardsInDeckAsync();
        var factIds = await db.FactIdsAsync();

        await db.OpenAsync();
        var afterSecond = await db.CardsInDeckAsync();

        Assert.Equal(afterFirst.Count, afterSecond.Count);
        Assert.Equal(factIds, await db.FactIdsAsync());
        Assert.Equal(
            afterFirst.Select(c => c.Id).Order(),
            afterSecond.Select(c => c.Id).Order());
    }

    [Fact]
    public async Task Deleting_a_fact_takes_the_cards_it_made_with_it()
    {
        await using var db = new LegacyDatabase(5);
        await db.AddCardAsync("card-1", FlashcardType.Cloze, "{{c1::A}} and {{c2::B}}", string.Empty);

        await db.OpenAsync();
        var factId = (await db.CardAsync("card-1")).FactId!;
        await db.ExecuteAsync("DELETE FROM FlashcardFacts WHERE Id = $id;", ("$id", factId));

        Assert.Empty(await db.CardsInDeckAsync());
    }

    [Fact]
    public async Task Deleting_a_deck_leaves_none_of_its_material_behind()
    {
        await using var db = new LegacyDatabase(5);
        await db.AddCardAsync("card-1", FlashcardType.Cloze, "{{c1::A}} and {{c2::B}}", string.Empty);
        await db.AddCardAsync("card-2", FlashcardType.Classic, "Question", "Answer");

        await db.OpenAsync();
        Assert.Equal(2, (await db.FactIdsAsync()).Count);

        await db.DeleteDeckAsync("deck-1");

        Assert.Empty(await db.FactIdsAsync());
        Assert.Empty(await db.CardsInDeckAsync());
    }

    /// <summary>
    /// A collection in the shape a build before card types wrote, opened by this one.
    /// </summary>
    private sealed class LegacyDatabase : IAsyncDisposable
    {
        private readonly string _path;

        public LegacyDatabase(int version)
        {
            _path = Path.Combine(Path.GetTempPath(), $"mnemo_fc_v{version}_{Guid.NewGuid():N}.db");
            Write(version);
        }

        /// <summary>Runs the store's initialization, which is where the upgrade happens.</summary>
        public async Task OpenAsync()
        {
            await using var store = new FlashcardStore(new TestLogger(), _path, new TestTimeProvider(Now));
            await store.InitializeAsync();
        }

        public Task AddCardAsync(
            string id, FlashcardType type, string front, string back,
            FlashcardCardState state = FlashcardCardState.Active,
            bool isFlagged = false,
            string tagsJson = "[]",
            string attachmentsJson = "[]",
            string? sourceType = null,
            string? sourceId = null,
            string? sourceLabel = null)
        {
            var stamp = Ts(Now);
            return ExecuteAsync(
                """
                INSERT INTO FlashcardCards
                    (Id, DeckId, Type, Front, Back, TagsJson, State, IsFlagged, AttachmentsJson,
                     SourceType, SourceId, SourceLabel, CreatedAt, UpdatedAt)
                VALUES ($id, 'deck-1', $type, $front, $back, $tags, $state, $flagged, $attach,
                     $srcType, $srcId, $srcLabel, $at, $at);
                INSERT INTO FlashcardScheduling (CardId, DueDate) VALUES ($id, $at);
                """,
                ("$id", id), ("$type", (int)type), ("$front", front), ("$back", back),
                ("$tags", tagsJson), ("$state", (int)state), ("$flagged", isFlagged ? 1 : 0),
                ("$attach", attachmentsJson),
                ("$srcType", (object?)sourceType ?? DBNull.Value),
                ("$srcId", (object?)sourceId ?? DBNull.Value),
                ("$srcLabel", (object?)sourceLabel ?? DBNull.Value),
                ("$at", stamp));
        }

        public Task SetScheduleAsync(string cardId, double stability, double difficulty, int reps, int lapses, int fsrsState) =>
            ExecuteAsync(
                """
                UPDATE FlashcardScheduling
                SET Stability = $stab, Difficulty = $diff, Reps = $reps, Lapses = $lapses,
                    FsrsState = $state, LastReviewedAt = $at
                WHERE CardId = $id;
                """,
                ("$id", cardId), ("$stab", stability), ("$diff", difficulty),
                ("$reps", reps), ("$lapses", lapses), ("$state", fsrsState), ("$at", Ts(Now)));

        public Task AddReviewAsync(string cardId) =>
            ExecuteAsync(
                """
                INSERT INTO FlashcardReviews
                    (CardId, DeckId, SessionId, Grade, ReviewedAt, ElapsedDays, ScheduledDays, StateAfter)
                VALUES ($id, 'deck-1', 'session-1', 3, $at, 1.0, 4.0, 2);
                """,
                ("$id", cardId), ("$at", Ts(Now)));

        public async Task<CardRow> CardAsync(string id) =>
            (await CardsInDeckAsync()).Single(c => c.Id == id);

        public async Task<IReadOnlyList<CardRow>> CardsInDeckAsync()
        {
            var rows = new List<CardRow>();
            await ReadAsync(
                "SELECT Id, Type, Front, Back, State, IsFlagged, AttachmentsJson, FactId, LayoutKey FROM FlashcardCards;",
                reader => rows.Add(new CardRow(
                    reader.GetString(0), (FlashcardType)reader.GetInt32(1), reader.GetString(2), reader.GetString(3),
                    (FlashcardCardState)reader.GetInt32(4), reader.GetInt32(5) != 0, reader.GetString(6),
                    reader.IsDBNull(7) ? null : reader.GetString(7),
                    reader.IsDBNull(8) ? null : reader.GetString(8))));
            return rows;
        }

        public async Task<FactRow> FactAsync(string id)
        {
            FactRow? row = null;
            await ReadAsync(
                """
                SELECT DeckId, TypeId, ValuesJson, MediaJson, TagsJson, IsFlagged, SourceType, SourceId, SourceLabel
                FROM FlashcardFacts WHERE Id = $id;
                """,
                reader => row = new FactRow(
                    reader.GetString(0), reader.GetString(1),
                    JsonNode.Parse(reader.GetString(2))!.AsObject()
                        .ToDictionary(p => p.Key, p => p.Value!.GetValue<string>()),
                    reader.GetString(3), reader.GetString(4), reader.GetInt32(5) != 0,
                    reader.IsDBNull(6) ? null : reader.GetString(6),
                    reader.IsDBNull(7) ? null : reader.GetString(7),
                    reader.IsDBNull(8) ? null : reader.GetString(8)),
                ("$id", id));
            return row ?? throw new InvalidOperationException($"No fact {id}.");
        }

        public async Task<ScheduleRow> ScheduleAsync(string cardId)
        {
            ScheduleRow? row = null;
            await ReadAsync(
                "SELECT Stability, Difficulty, Reps, Lapses, FsrsState FROM FlashcardScheduling WHERE CardId = $id;",
                reader => row = new ScheduleRow(
                    reader.IsDBNull(0) ? null : reader.GetDouble(0),
                    reader.IsDBNull(1) ? null : reader.GetDouble(1),
                    reader.GetInt32(2), reader.GetInt32(3), reader.GetInt32(4)),
                ("$id", cardId));
            return row ?? throw new InvalidOperationException($"No schedule for {cardId}.");
        }

        public async Task<int> ReviewCountAsync(string cardId)
        {
            var count = 0;
            await ReadAsync(
                "SELECT COUNT(*) FROM FlashcardReviews WHERE CardId = $id;",
                reader => count = reader.GetInt32(0),
                ("$id", cardId));
            return count;
        }

        public async Task<IReadOnlyList<string>> CardTypeIdsAsync()
        {
            var ids = new List<string>();
            await ReadAsync("SELECT Id FROM FlashcardCardTypes ORDER BY Id;", reader => ids.Add(reader.GetString(0)));
            return ids;
        }

        /// <summary>Deletes through the library service, so the test sees what the app does: the
        /// repository alone only takes the deck row, material cleanup is the service's job.</summary>
        public async Task DeleteDeckAsync(string deckId)
        {
            var time = new TestTimeProvider(Now);
            await using var store = new FlashcardStore(new TestLogger(), _path, time);
            await store.InitializeAsync();
            var library = new FlashcardLibraryService(
                store, new FolderRepository(), new DeckRepository(), new CardRepository(), new FactRepository(),
                new ScheduleRepository(), new ReviewRepository(), new DailyStatsRepository(), new PresetRepository(),
                new FlashcardClock(time));
            await library.DeleteDeckAsync(deckId);
        }

        public async Task<IReadOnlyList<string>> FactIdsAsync()
        {
            var ids = new List<string>();
            await ReadAsync("SELECT Id FROM FlashcardFacts ORDER BY Id;", reader => ids.Add(reader.GetString(0)));
            return ids;
        }

        public async Task ExecuteAsync(string sql, params (string Name, object Value)[] parameters)
        {
            await using var conn = await ConnectAsync();
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = sql;
            foreach (var (name, value) in parameters)
                cmd.Parameters.AddWithValue(name, value);
            await cmd.ExecuteNonQueryAsync();
        }

        private async Task ReadAsync(string sql, Action<SqliteDataReader> read, params (string Name, object Value)[] parameters)
        {
            await using var conn = await ConnectAsync();
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = sql;
            foreach (var (name, value) in parameters)
                cmd.Parameters.AddWithValue(name, value);
            await using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
                read(reader);
        }

        private async Task<SqliteConnection> ConnectAsync()
        {
            var conn = new SqliteConnection($"Data Source={_path}");
            await conn.OpenAsync();
            await using var pragma = conn.CreateCommand();
            pragma.CommandText = "PRAGMA foreign_keys=ON;";
            await pragma.ExecuteNonQueryAsync();
            return conn;
        }

        /// <summary>
        /// The pre-fact shape, written by hand, stamped at the version under test. The columns a
        /// later release added are left off on purpose: the upgrade has to put them back, and a
        /// database that skipped releases is exactly the case worth covering.
        /// </summary>
        private void Write(int version)
        {
            using var conn = new SqliteConnection($"Data Source={_path}");
            conn.Open();
            using var cmd = conn.CreateCommand();
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
                CREATE TABLE FlashcardCards (
                    Id TEXT PRIMARY KEY,
                    DeckId TEXT NOT NULL REFERENCES FlashcardDecks(Id) ON DELETE CASCADE,
                    Type INTEGER NOT NULL DEFAULT 0, Front TEXT NOT NULL, Back TEXT NOT NULL,
                    FrontRich TEXT NULL, BackRich TEXT NULL, TagsJson TEXT NOT NULL DEFAULT '[]',
                    State INTEGER NOT NULL DEFAULT 0, IsFlagged INTEGER NOT NULL DEFAULT 0,
                    AttachmentsJson TEXT NOT NULL DEFAULT '[]', SourceType TEXT NULL, SourceId TEXT NULL,
                    SourceLabel TEXT NULL, CreatedAt TEXT NOT NULL, UpdatedAt TEXT NOT NULL);
                CREATE TABLE FlashcardScheduling (
                    CardId TEXT PRIMARY KEY REFERENCES FlashcardCards(Id) ON DELETE CASCADE,
                    DueDate TEXT NOT NULL, Stability REAL NULL, Difficulty REAL NULL,
                    Reps INTEGER NOT NULL DEFAULT 0, Lapses INTEGER NOT NULL DEFAULT 0,
                    FsrsState INTEGER NOT NULL DEFAULT 0, LearningStepIndex INTEGER NOT NULL DEFAULT 0,
                    LastReviewedAt TEXT NULL);
                CREATE TABLE FlashcardReviews (
                    Id INTEGER PRIMARY KEY AUTOINCREMENT, CardId TEXT NOT NULL, DeckId TEXT NOT NULL,
                    SessionId TEXT NOT NULL, Grade INTEGER NOT NULL, ReviewedAt TEXT NOT NULL,
                    ElapsedDays REAL NOT NULL, ScheduledDays REAL NOT NULL, StabilityAfter REAL NULL,
                    DifficultyAfter REAL NULL, StateAfter INTEGER NOT NULL);
                CREATE VIRTUAL TABLE FlashcardCardsFts USING fts5(
                    Front, Back, Tags, content='FlashcardCards', content_rowid='rowid');
                CREATE TRIGGER FlashcardCards_ai AFTER INSERT ON FlashcardCards BEGIN
                    INSERT INTO FlashcardCardsFts(rowid, Front, Back, Tags)
                    VALUES (new.rowid, new.Front, new.Back, new.TagsJson);
                END;
                CREATE TRIGGER FlashcardCards_ad AFTER DELETE ON FlashcardCards BEGIN
                    INSERT INTO FlashcardCardsFts(FlashcardCardsFts, rowid, Front, Back, Tags)
                    VALUES ('delete', old.rowid, old.Front, old.Back, old.TagsJson);
                END;
                CREATE TRIGGER FlashcardCards_au AFTER UPDATE ON FlashcardCards BEGIN
                    INSERT INTO FlashcardCardsFts(FlashcardCardsFts, rowid, Front, Back, Tags)
                    VALUES ('delete', old.rowid, old.Front, old.Back, old.TagsJson);
                    INSERT INTO FlashcardCardsFts(rowid, Front, Back, Tags)
                    VALUES (new.rowid, new.Front, new.Back, new.TagsJson);
                END;
                INSERT INTO FlashcardPresets (Id, Name, CreatedAt, UpdatedAt)
                VALUES ('preset-1', 'Standard', '2026-01-01T00:00:00.0000000+00:00', '2026-01-01T00:00:00.0000000+00:00');
                INSERT INTO FlashcardDecks (Id, PresetId, Name, CreatedAt, UpdatedAt)
                VALUES ('deck-1', 'preset-1', 'Antiarrhythmics', '2026-01-01T00:00:00.0000000+00:00', '2026-01-01T00:00:00.0000000+00:00');
                """;
            cmd.ExecuteNonQuery();

            using var stamp = conn.CreateCommand();
            stamp.CommandText = "INSERT INTO FlashcardSchemaVersion (Version, AppliedAt) VALUES ($v, '2026-01-01T00:00:00.0000000+00:00');";
            stamp.Parameters.AddWithValue("$v", version);
            stamp.ExecuteNonQuery();
        }

        private static string Ts(DateTimeOffset value) =>
            value.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture);

        public ValueTask DisposeAsync()
        {
            SqliteConnection.ClearAllPools();
            foreach (var file in new[] { _path, _path + "-wal", _path + "-shm" })
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
            return ValueTask.CompletedTask;
        }
    }

    private sealed record CardRow(
        string Id, FlashcardType Type, string Front, string Back, FlashcardCardState State,
        bool IsFlagged, string AttachmentsJson, string? FactId, string? LayoutKey);

    private sealed record FactRow(
        string DeckId, string TypeId, IReadOnlyDictionary<string, string> Values, string MediaJson,
        string TagsJson, bool IsFlagged, string? SourceType, string? SourceId, string? SourceLabel);

    private sealed record ScheduleRow(double? Stability, double? Difficulty, int Reps, int Lapses, int FsrsState);
}
