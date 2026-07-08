namespace Mnemo.Infrastructure.Services.Mindmap.Persistence;

/// <summary>
/// DDL for the relational mindmap store. The document JSON is canonical (one row per map); the FTS5
/// mirror indexes element text for in-map search and is maintained incrementally from each commit's
/// touched-id set. Library organization (folders, folder membership, linked decks) is stored
/// alongside as row metadata, kept off the pure document model. Kept out of <see cref="MindmapStore"/>
/// so the store body stays focused on connection and transaction mechanics.
/// </summary>
internal static class MindmapStoreSchema
{
    /// <summary>Target schema version. Bump alongside a migration step in the store.</summary>
    public const int TargetVersion = 3;

    /// <summary>Every table and the FTS virtual table, created if absent (fresh databases).</summary>
    public const string CreateSql = """
        CREATE TABLE IF NOT EXISTS MindmapSchemaVersion (
            Version   INTEGER PRIMARY KEY,
            AppliedAt TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS Mindmaps (
            Id              TEXT PRIMARY KEY,
            Title           TEXT NOT NULL,
            SchemaVersion   INTEGER NOT NULL,
            Revision        INTEGER NOT NULL,
            Doc             TEXT NOT NULL,
            CreatedAt       TEXT NOT NULL,
            ModifiedAt      TEXT NOT NULL,
            FolderId        TEXT NULL,
            LinkedDecksJson TEXT NOT NULL DEFAULT '[]'
        );

        -- Library folders. Subfolders cascade on delete; a deleted folder's maps keep a dangling FolderId
        -- and surface at the library root (resolved in the UI), so Mindmaps.FolderId is intentionally not
        -- a foreign key.
        CREATE TABLE IF NOT EXISTS MindmapFolders (
            Id        TEXT PRIMARY KEY,
            ParentId  TEXT NULL REFERENCES MindmapFolders(Id) ON DELETE CASCADE,
            Name      TEXT NOT NULL,
            SortOrder INTEGER NOT NULL DEFAULT 0
        );

        -- User style templates, global across all maps. The whole template is stored as JSON; Name is
        -- kept as an indexed header column so the picker can list without deserializing every row.
        CREATE TABLE IF NOT EXISTS MindmapStyleTemplates (
            Id        TEXT PRIMARY KEY,
            Name      TEXT NOT NULL,
            Json      TEXT NOT NULL,
            CreatedAt TEXT NOT NULL
        );

        -- Self-contained FTS5 mirror: MapId/ElementId are stored but not tokenized (UNINDEXED); only
        -- Text is searchable. Rows are inserted/deleted per touched element on commit, so DELETE ... WHERE
        -- on the un-indexed columns is used (a standalone FTS5 table supports ordinary DML).
        CREATE VIRTUAL TABLE IF NOT EXISTS MindmapSearch USING fts5(
            MapId UNINDEXED, ElementId UNINDEXED, Text
        );
        """;

    /// <summary>
    /// Idempotent ALTER statements bringing a v1 database (maps only, no library columns/folders) up to
    /// v2. The folders table is created by <see cref="CreateSql"/>; only the new Mindmaps columns need
    /// adding to an existing table. Guarded per-column by the store via PRAGMA table_info. v3 adds the
    /// style-templates table, which needs no ALTER since <see cref="CreateSql"/> creates it if absent.
    /// </summary>
    public const string AddFolderIdColumnSql = "ALTER TABLE Mindmaps ADD COLUMN FolderId TEXT NULL;";

    public const string AddLinkedDecksColumnSql = "ALTER TABLE Mindmaps ADD COLUMN LinkedDecksJson TEXT NOT NULL DEFAULT '[]';";
}
