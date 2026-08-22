namespace Mnemo.Infrastructure.Services.Flashcards.Persistence;

/// <summary>
/// DDL for v1 of the relational flashcard store. Kept out of <see cref="FlashcardStore"/> so the
/// store body stays focused on connection, transaction and migration mechanics.
/// </summary>
internal static class FlashcardStoreSchema
{
    /// <summary>Target schema version. Bump alongside a migration step in the store.</summary>
    public const int TargetVersion = 11;

    /// <summary>
    /// Columns added after v1, for databases that already exist.
    /// </summary>
    /// <remarks>
    /// CREATE TABLE IF NOT EXISTS builds a fresh database correctly and does nothing at all
    /// to one that is already there, so a new column has to be added a second way. Applied
    /// only where absent, which keeps both paths on the same statement.
    /// </remarks>
    public static readonly (string Table, string Column, string Definition)[] AddedColumns =
    [
        ("FlashcardDecks", "Icon", "TEXT NULL"),
        ("FlashcardReviews", "StateBefore", "INTEGER NULL"),
        ("FlashcardPresets", "NextDayStartsAtHour", "INTEGER NOT NULL DEFAULT 4"),
        ("FlashcardPresets", "LeechThreshold", "INTEGER NOT NULL DEFAULT 8"),
        ("FlashcardPresets", "LeechAction", "INTEGER NOT NULL DEFAULT 1"),
        ("FlashcardCards", "FactId", "TEXT NULL REFERENCES FlashcardFacts(Id) ON DELETE CASCADE"),
        ("FlashcardCards", "LayoutKey", "TEXT NULL"),
        ("FlashcardScheduling", "BuriedUntil", "TEXT NULL"),
        // Non-null names the trash entry holding the row. Null is the only default, so every row
        // that already exists reads as live and no backfill is needed.
        ("FlashcardFolders", "TrashId", "TEXT NULL"),
        ("FlashcardDecks", "TrashId", "TEXT NULL"),
        ("FlashcardFacts", "TrashId", "TEXT NULL"),
        ("FlashcardCards", "TrashId", "TEXT NULL"),
        // Where the answer came from. Zero is answered here, which is what every row written
        // before the column existed was, so the default needs no backfill.
        ("FlashcardReviews", "Origin", "INTEGER NOT NULL DEFAULT 0"),
    ];

    /// <summary>
    /// Indexes over columns that <see cref="AddedColumns"/> supplies, so they can only be created
    /// once those have been applied. A fresh database gets the columns from <see cref="CreateSql"/>
    /// and lands here with nothing to do.
    /// </summary>
    /// <remarks>
    /// The unique index over a card's material and layout deliberately covers held cards too. A
    /// layout has one card whatever the trash is doing with it, which is what makes a restore
    /// impossible to collide: nothing can have taken the slot while the card was away.
    /// </remarks>
    public const string CreateIndexesOverAddedColumnsSql = """
        CREATE UNIQUE INDEX IF NOT EXISTS UX_Cards_Fact_Layout ON FlashcardCards(FactId, LayoutKey);
        CREATE INDEX IF NOT EXISTS IX_Cards_Fact ON FlashcardCards(FactId);

        CREATE INDEX IF NOT EXISTS IX_Folders_Trash ON FlashcardFolders(TrashId) WHERE TrashId IS NOT NULL;
        CREATE INDEX IF NOT EXISTS IX_Decks_Trash   ON FlashcardDecks(TrashId)   WHERE TrashId IS NOT NULL;
        CREATE INDEX IF NOT EXISTS IX_Facts_Trash   ON FlashcardFacts(TrashId)   WHERE TrashId IS NOT NULL;
        CREATE INDEX IF NOT EXISTS IX_Cards_Trash   ON FlashcardCards(TrashId)   WHERE TrashId IS NOT NULL;

        CREATE INDEX IF NOT EXISTS IX_Cards_Live_Deck ON FlashcardCards(DeckId, TrashId);
        CREATE INDEX IF NOT EXISTS IX_Facts_Live_Deck ON FlashcardFacts(DeckId, TrashId);

        -- The trash indexes above cover TrashId IS NOT NULL only; the ordinary deck and folder
        -- listings filter IS NULL and sort by SortOrder, Name, so they need their own composite.
        CREATE INDEX IF NOT EXISTS IX_Decks_Live   ON FlashcardDecks(TrashId, SortOrder, Name);
        CREATE INDEX IF NOT EXISTS IX_Folders_Live ON FlashcardFolders(TrashId, SortOrder, Name);
        """;

    /// <summary>Every table, index, FTS virtual table and trigger, created if absent.</summary>
    public const string CreateSql = """
        CREATE TABLE IF NOT EXISTS FlashcardSchemaVersion (
            Version   INTEGER PRIMARY KEY,
            AppliedAt TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS FlashcardFolders (
            Id         TEXT PRIMARY KEY,
            ParentId   TEXT NULL REFERENCES FlashcardFolders(Id) ON DELETE CASCADE,
            Name       TEXT NOT NULL,
            SortOrder  INTEGER NOT NULL DEFAULT 0,
            CreatedAt  TEXT NOT NULL,
            UpdatedAt  TEXT NOT NULL,
            TrashId    TEXT NULL
        );

        CREATE TABLE IF NOT EXISTS FlashcardPresets (
            Id                TEXT PRIMARY KEY,
            Name              TEXT NOT NULL,
            NewPerDay         INTEGER NOT NULL DEFAULT 20,
            MaxReviewsPerDay  INTEGER NOT NULL DEFAULT 200,
            Algorithm         INTEGER NOT NULL DEFAULT 1,
            DesiredRetention  REAL    NOT NULL DEFAULT 0.9,
            LearningStepsJson TEXT    NOT NULL DEFAULT '[1,10]',
            RelearnStepsJson  TEXT    NOT NULL DEFAULT '[10]',
            ShuffleOrder      INTEGER NOT NULL DEFAULT 0,
            BuryRelated       INTEGER NOT NULL DEFAULT 1,
            AutoReveal        TEXT    NOT NULL DEFAULT 'off',
            WeightsJson       TEXT    NULL,
            CreatedAt         TEXT NOT NULL,
            UpdatedAt         TEXT NOT NULL,
            NextDayStartsAtHour INTEGER NOT NULL DEFAULT 4,
            LeechThreshold    INTEGER NOT NULL DEFAULT 8,
            LeechAction       INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS FlashcardDecks (
            Id          TEXT PRIMARY KEY,
            FolderId    TEXT NULL REFERENCES FlashcardFolders(Id) ON DELETE SET NULL,
            PresetId    TEXT NOT NULL REFERENCES FlashcardPresets(Id),
            Name        TEXT NOT NULL,
            Description TEXT NULL,
            TagsJson    TEXT NOT NULL DEFAULT '[]',
            SortOrder   INTEGER NOT NULL DEFAULT 0,
            LastStudied TEXT NULL,
            Icon        TEXT NULL,
            CreatedAt   TEXT NOT NULL,
            UpdatedAt   TEXT NOT NULL,
            TrashId     TEXT NULL
        );

        CREATE TABLE IF NOT EXISTS FlashcardCardTypes (
            Id           TEXT PRIMARY KEY,
            Name         TEXT NOT NULL,
            IsBuiltIn    INTEGER NOT NULL DEFAULT 0,
            FieldsJson   TEXT NOT NULL DEFAULT '[]',
            SortFieldId  TEXT NOT NULL,
            LayoutsJson  TEXT NOT NULL DEFAULT '[]',
            Generator    TEXT NULL,
            GenerateFrom TEXT NULL,
            CreatedAt    TEXT NOT NULL,
            UpdatedAt    TEXT NOT NULL
        );

        -- TypeId carries no foreign key on purpose: a fact whose type has been deleted still has
        -- to list and open, falling back to the basic type, rather than blocking the delete or
        -- taking the material down with it.
        CREATE TABLE IF NOT EXISTS FlashcardFacts (
            Id          TEXT PRIMARY KEY,
            DeckId      TEXT NOT NULL,
            TypeId      TEXT NOT NULL,
            ValuesJson  TEXT NOT NULL DEFAULT '{}',
            MediaJson   TEXT NOT NULL DEFAULT '{}',
            TagsJson    TEXT NOT NULL DEFAULT '[]',
            IsFlagged   INTEGER NOT NULL DEFAULT 0,
            SourceType  TEXT NULL,
            SourceId    TEXT NULL,
            SourceLabel TEXT NULL,
            CreatedAt   TEXT NOT NULL,
            UpdatedAt   TEXT NOT NULL,
            TrashId     TEXT NULL
        );

        CREATE TABLE IF NOT EXISTS FlashcardCards (
            Id             TEXT PRIMARY KEY,
            DeckId         TEXT NOT NULL REFERENCES FlashcardDecks(Id) ON DELETE CASCADE,
            Type           INTEGER NOT NULL DEFAULT 0,
            Front          TEXT NOT NULL,
            Back           TEXT NOT NULL,
            FrontRich      TEXT NULL,
            BackRich       TEXT NULL,
            TagsJson       TEXT NOT NULL DEFAULT '[]',
            State          INTEGER NOT NULL DEFAULT 0,
            IsFlagged      INTEGER NOT NULL DEFAULT 0,
            AttachmentsJson TEXT NOT NULL DEFAULT '[]',
            SourceType     TEXT NULL,
            SourceId       TEXT NULL,
            SourceLabel    TEXT NULL,
            CreatedAt      TEXT NOT NULL,
            UpdatedAt      TEXT NOT NULL,
            FactId         TEXT NULL REFERENCES FlashcardFacts(Id) ON DELETE CASCADE,
            LayoutKey      TEXT NULL,
            TrashId        TEXT NULL
        );

        CREATE TABLE IF NOT EXISTS FlashcardScheduling (
            CardId            TEXT PRIMARY KEY REFERENCES FlashcardCards(Id) ON DELETE CASCADE,
            DueDate           TEXT NOT NULL,
            Stability         REAL NULL,
            Difficulty        REAL NULL,
            Reps              INTEGER NOT NULL DEFAULT 0,
            Lapses            INTEGER NOT NULL DEFAULT 0,
            FsrsState         INTEGER NOT NULL DEFAULT 0,
            LearningStepIndex INTEGER NOT NULL DEFAULT 0,
            LastReviewedAt    TEXT NULL,
            -- When set and still ahead, the card is held back from the queue and the counts
            -- because another card off the same material was answered. Null means never buried.
            BuriedUntil       TEXT NULL
        );

        -- Origin is zero for an answer given here and one for history an import carried in.
        -- Imported rows count towards retention and train the scheduler like any other; the marker
        -- exists so analytics can separate them later. Kept out of the table body deliberately: a
        -- comment sitting against the last column makes ALTER TABLE DROP COLUMN leave behind text
        -- SQLite can no longer parse.
        CREATE TABLE IF NOT EXISTS FlashcardReviews (
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
            StateAfter      INTEGER NOT NULL,
            -- Null on rows written before the column existed: those reviews genuinely have no
            -- recorded starting state, and guessing one would be worse than admitting it.
            StateBefore     INTEGER NULL,
            Origin          INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS FlashcardTestAttempts (
            Id           TEXT PRIMARY KEY,
            DeckId       TEXT NOT NULL,
            StartedAt    TEXT NOT NULL,
            CompletedAt  TEXT NOT NULL,
            CardsTested  INTEGER NOT NULL,
            GotItCount   INTEGER NOT NULL,
            CloseCount   INTEGER NOT NULL,
            MissedCount  INTEGER NOT NULL,
            ScorePct     REAL NOT NULL
        );

        CREATE TABLE IF NOT EXISTS FlashcardDailyStats (
            DeckId        TEXT NOT NULL,
            Date          TEXT NOT NULL,
            NewIntroduced INTEGER NOT NULL DEFAULT 0,
            ReviewsDone   INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (DeckId, Date)
        );

        -- A fact whose home deck went to the trash while its other cards stayed live is filed
        -- under one of those live decks instead, so nothing live points at a deck nobody can see.
        -- The move is recorded here so restoring the deck can put the fact back, and only if the
        -- fact is still where the move left it: a filing the user chose in between wins.
        CREATE TABLE IF NOT EXISTS FlashcardTrashFactHomes (
            TrashId           TEXT NOT NULL,
            FactId            TEXT NOT NULL,
            OriginalDeckId    TEXT NOT NULL,
            ReplacementDeckId TEXT NOT NULL,
            PRIMARY KEY (TrashId, FactId)
        );

        CREATE INDEX IF NOT EXISTS IX_Facts_Deck        ON FlashcardFacts(DeckId);
        CREATE INDEX IF NOT EXISTS IX_Cards_Deck        ON FlashcardCards(DeckId);
        CREATE INDEX IF NOT EXISTS IX_Cards_State       ON FlashcardCards(DeckId, State);
        CREATE INDEX IF NOT EXISTS IX_Sched_Due         ON FlashcardScheduling(DueDate);
        CREATE INDEX IF NOT EXISTS IX_Reviews_Deck_Time ON FlashcardReviews(DeckId, ReviewedAt);
        CREATE INDEX IF NOT EXISTS IX_Reviews_Card      ON FlashcardReviews(CardId);
        CREATE INDEX IF NOT EXISTS IX_TestAttempts_Deck ON FlashcardTestAttempts(DeckId, CompletedAt);

        CREATE VIRTUAL TABLE IF NOT EXISTS FlashcardCardsFts USING fts5(
            Front, Back, Tags, content='FlashcardCards', content_rowid='rowid'
        );

        CREATE TRIGGER IF NOT EXISTS FlashcardCards_ai AFTER INSERT ON FlashcardCards BEGIN
            INSERT INTO FlashcardCardsFts(rowid, Front, Back, Tags)
            VALUES (new.rowid, new.Front, new.Back, new.TagsJson);
        END;

        CREATE TRIGGER IF NOT EXISTS FlashcardCards_ad AFTER DELETE ON FlashcardCards BEGIN
            INSERT INTO FlashcardCardsFts(FlashcardCardsFts, rowid, Front, Back, Tags)
            VALUES ('delete', old.rowid, old.Front, old.Back, old.TagsJson);
        END;

        CREATE TRIGGER IF NOT EXISTS FlashcardCards_au AFTER UPDATE ON FlashcardCards BEGIN
            INSERT INTO FlashcardCardsFts(FlashcardCardsFts, rowid, Front, Back, Tags)
            VALUES ('delete', old.rowid, old.Front, old.Back, old.TagsJson);
            INSERT INTO FlashcardCardsFts(rowid, Front, Back, Tags)
            VALUES (new.rowid, new.Front, new.Back, new.TagsJson);
        END;
        """;
}
