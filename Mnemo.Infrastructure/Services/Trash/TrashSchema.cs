namespace Mnemo.Infrastructure.Services.Trash;

/// <summary>
/// The tables behind the application wide trash. Both live in <c>mnemo.db</c> alongside every
/// module's own tables, and both are created with <c>IF NOT EXISTS</c>, so opening an already
/// upgraded database changes nothing.
/// </summary>
internal static class TrashSchema
{
    /// <summary>
    /// The ledger.
    /// </summary>
    /// <remarks>
    /// One row per top-level item a person asked to delete, not one row per storage row in the
    /// cascade behind it. Sources keep the structural ids they need in the rows they mark, so
    /// <c>Title</c>, <c>Origin</c> and <c>ContainedCount</c> are display snapshots rather than
    /// restore keys.
    /// </remarks>
    public const string LedgerSql = @"
CREATE TABLE IF NOT EXISTS TrashEntries (
    Id             TEXT PRIMARY KEY,
    Kind           TEXT NOT NULL,
    ItemId         TEXT NOT NULL,
    Title          TEXT NOT NULL,
    Origin         TEXT NULL,
    ContainedCount INTEGER NOT NULL DEFAULT 0,
    BatchId        TEXT NOT NULL,
    State          TEXT NOT NULL,
    DeletedAt      TEXT NOT NULL,
    ExpiresAt      TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS UX_TrashEntries_Item
    ON TrashEntries(Kind, ItemId);
CREATE INDEX IF NOT EXISTS IX_TrashEntries_List
    ON TrashEntries(State, DeletedAt DESC, Id DESC);
CREATE INDEX IF NOT EXISTS IX_TrashEntries_KindList
    ON TrashEntries(State, Kind, DeletedAt DESC, Id DESC);
CREATE INDEX IF NOT EXISTS IX_TrashEntries_Expiry
    ON TrashEntries(State, ExpiresAt);
CREATE INDEX IF NOT EXISTS IX_TrashEntries_Batch
    ON TrashEntries(BatchId);
";

    /// <summary>
    /// The durable second stage of purge.
    /// </summary>
    /// <remarks>
    /// A job is written inside the same transaction that removes an asset's last owning rows, so a
    /// crash between the database delete and the file delete leaves an orphan file for the next
    /// pass rather than restorable data pointing at a deleted file. Module purges assert this
    /// table themselves, because a purge must be able to enqueue whether or not the trash
    /// subsystem happens to have started first.
    /// </remarks>
    public const string CleanupSql = @"
CREATE TABLE IF NOT EXISTS AssetCleanupJobs (
    Id         TEXT PRIMARY KEY,
    Owner      TEXT NOT NULL,
    Path       TEXT NOT NULL,
    EnqueuedAt TEXT NOT NULL,
    Attempts   INTEGER NOT NULL DEFAULT 0,
    LastError  TEXT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS UX_AssetCleanupJobs_OwnerPath
    ON AssetCleanupJobs(Owner, Path);
";

    /// <summary>Everything the trash subsystem needs present.</summary>
    public const string CreateSql = LedgerSql + CleanupSql;
}
