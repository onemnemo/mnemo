namespace Mnemo.Host.Trash;

/// <summary>What happened when an asset store was asked to remove a queued file.</summary>
public enum AssetCleanupOutcome
{
    /// <summary>Nothing referenced the file and it is gone from disk.</summary>
    Deleted = 0,

    /// <summary>Live or trashed content still points at the file, so it was kept.</summary>
    StillReferenced = 1,

    /// <summary>The file was already gone.</summary>
    Missing = 2
}

/// <summary>
/// The module side of asset cleanup. One implementation owns one asset store, and it is the only
/// authority on whether anything still references a file.
/// </summary>
/// <remarks>
/// The reference check must cover trashed content as well as live content. A file shared by a
/// deleted note and a note still in the trash has to survive, or restoring that second note would
/// bring back a body pointing at nothing.
/// </remarks>
public interface IAssetCleanupOwner
{
    /// <summary>The owner key module purges write into their cleanup jobs.</summary>
    string Owner { get; }

    /// <summary>
    /// Whether this owner can answer reference questions yet. A job queued for an owner that is
    /// still starting waits for a later pass rather than being counted as failed.
    /// </summary>
    bool IsReady { get; }

    /// <summary>Deletes the file if nothing references it, and reports which of those happened.</summary>
    Task<AssetCleanupOutcome> DeleteIfUnreferencedAsync(string path, CancellationToken cancellationToken = default);
}
