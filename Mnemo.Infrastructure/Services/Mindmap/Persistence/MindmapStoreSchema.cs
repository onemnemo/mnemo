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
    public const int TargetVersion = 6;

    /// <summary>Every table and the FTS virtual table, created if absent (fresh databases).</summary>
    public const string CreateSql = """
        CREATE TABLE IF NOT EXISTS MindmapSchemaVersion (
            Version   INTEGER PRIMARY KEY,
            AppliedAt TEXT NOT NULL
        );

        -- TrashId marks a row the trash holds. It is the entry id in the shared ledger, and while it is
        -- set the row is invisible to every ordinary read: the map is deleted as far as the app is
        -- concerned, and only the recovery screen can bring it back.
        CREATE TABLE IF NOT EXISTS Mindmaps (
            Id              TEXT PRIMARY KEY,
            Title           TEXT NOT NULL,
            SchemaVersion   INTEGER NOT NULL,
            Revision        INTEGER NOT NULL,
            Doc             TEXT NOT NULL,
            CreatedAt       TEXT NOT NULL,
            ModifiedAt      TEXT NOT NULL,
            FolderId        TEXT NULL,
            LinkedDecksJson TEXT NOT NULL DEFAULT '[]',
            TrashId         TEXT NULL,
            Sid             TEXT NULL
        );

        -- Library folders. Subfolders cascade on delete; a deleted folder's maps keep a dangling FolderId
        -- and surface at the library root (resolved in the UI), so Mindmaps.FolderId is intentionally not
        -- a foreign key.
        CREATE TABLE IF NOT EXISTS MindmapFolders (
            Id        TEXT PRIMARY KEY,
            ParentId  TEXT NULL REFERENCES MindmapFolders(Id) ON DELETE CASCADE,
            Name      TEXT NOT NULL,
            SortOrder INTEGER NOT NULL DEFAULT 0,
            TrashId   TEXT NULL
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

    /// <summary>v3 to v4: the column the trash marks a held map with.</summary>
    public const string AddMapTrashIdColumnSql = "ALTER TABLE Mindmaps ADD COLUMN TrashId TEXT NULL;";

    /// <summary>v3 to v4: the same column on folders, so a folder can be held with its subtree.</summary>
    public const string AddFolderTrashIdColumnSql = "ALTER TABLE MindmapFolders ADD COLUMN TrashId TEXT NULL;";

    /// <summary>
    /// Indexes over the trash column, applied after the migration has added it so an upgrade of an
    /// existing database does not index a column that is not there yet.
    /// </summary>
    /// <remarks>
    /// Two shapes, because the two readers want opposite halves. Ordinary reads filter on
    /// <c>TrashId IS NULL</c> and sort by ModifiedAt, so the live index leads with the filter and
    /// carries the sort. The trash reads one entry's rows and is partial, so it stays as small as the
    /// number of held rows rather than the size of the library.
    /// </remarks>
    public const string TrashIndexSql = """
        CREATE INDEX IF NOT EXISTS IX_Mindmaps_Live ON Mindmaps(TrashId, ModifiedAt DESC);
        CREATE INDEX IF NOT EXISTS IX_Mindmaps_Trash ON Mindmaps(TrashId) WHERE TrashId IS NOT NULL;
        CREATE INDEX IF NOT EXISTS IX_MindmapFolders_Trash ON MindmapFolders(TrashId) WHERE TrashId IS NOT NULL;
        """;

    /// <summary>
    /// v4 to v5: live-row index for the folder listing, the same gap <see cref="TrashIndexSql"/>
    /// already closed for maps. TrashId and SortOrder both exist on this table by v4, so the step
    /// is index-only; GetFoldersAsync's only ORDER BY key is SortOrder, so the index carries it.
    /// </summary>
    public const string FoldersLiveIndexSql =
        "CREATE INDEX IF NOT EXISTS IX_MindmapFolders_Live ON MindmapFolders(TrashId, SortOrder);";

    /// <summary>v5 to v6: the corpus-unique short id the AI tools address a map by.</summary>
    public const string AddMapSidColumnSql = "ALTER TABLE Mindmaps ADD COLUMN Sid TEXT NULL;";

    /// <summary>
    /// Applied unconditionally alongside the column, on both a database upgrading into it and a fresh
    /// one that already has it from <see cref="CreateSql"/>.
    /// </summary>
    public const string MapSidIndexSql =
        "CREATE UNIQUE INDEX IF NOT EXISTS IX_Mindmaps_Sid ON Mindmaps(Sid) WHERE Sid IS NOT NULL;";
}
