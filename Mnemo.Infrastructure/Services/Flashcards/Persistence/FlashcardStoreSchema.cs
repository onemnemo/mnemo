namespace Mnemo.Infrastructure.Services.Flashcards.Persistence;

/// <summary>
/// DDL for v1 of the relational flashcard store. Kept out of <see cref="FlashcardStore"/> so the
/// store body stays focused on connection, transaction and migration mechanics.
/// </summary>
internal static class FlashcardStoreSchema
{
    /// <summary>Target schema version. Bump alongside a migration step in the store.</summary>
    public const int TargetVersion = 2;

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
    ];

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
            UpdatedAt  TEXT NOT NULL
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
            UpdatedAt         TEXT NOT NULL
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
            UpdatedAt   TEXT NOT NULL
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
            UpdatedAt      TEXT NOT NULL
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
            LastReviewedAt    TEXT NULL
        );

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
            StateAfter      INTEGER NOT NULL
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
