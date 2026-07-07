namespace Mnemo.Infrastructure.Services.MindmapV2.Persistence;

/// <summary>
/// DDL for the relational mindmap store. The document JSON is canonical (one row per map); the FTS5
/// mirror indexes element text for in-map search and is maintained incrementally from each commit's
/// touched-id set. Kept out of <see cref="MindmapStore"/> so the store body stays focused on
/// connection and transaction mechanics — matching the flashcard store's layout.
/// </summary>
internal static class MindmapStoreSchema
{
    /// <summary>Target schema version. Bump alongside a migration step in the store.</summary>
    public const int TargetVersion = 1;

    /// <summary>Every table and the FTS virtual table, created if absent.</summary>
    public const string CreateSql = """
        CREATE TABLE IF NOT EXISTS MindmapSchemaVersion (
            Version   INTEGER PRIMARY KEY,
            AppliedAt TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS Mindmaps (
            Id            TEXT PRIMARY KEY,
            Title         TEXT NOT NULL,
            SchemaVersion INTEGER NOT NULL,
            Revision      INTEGER NOT NULL,
            Doc           TEXT NOT NULL,
            CreatedAt     TEXT NOT NULL,
            ModifiedAt    TEXT NOT NULL
        );

        -- Self-contained FTS5 mirror: MapId/ElementId are stored but not tokenized (UNINDEXED); only
        -- Text is searchable. Rows are inserted/deleted per touched element on commit, so DELETE ... WHERE
        -- on the un-indexed columns is used (a standalone FTS5 table supports ordinary DML).
        CREATE VIRTUAL TABLE IF NOT EXISTS MindmapSearch USING fts5(
            MapId UNINDEXED, ElementId UNINDEXED, Text
        );
        """;
}
