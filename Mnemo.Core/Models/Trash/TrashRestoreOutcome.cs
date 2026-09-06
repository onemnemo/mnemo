namespace Mnemo.Core.Models.Trash;

/// <summary>
/// What happened when a source was asked to put one entry back.
/// </summary>
public enum TrashRestoreOutcome
{
    /// <summary>The item returned to the container it was taken from.</summary>
    Restored = 0,

    /// <summary>The source no longer holds the entry, so there was nothing to put back.</summary>
    Missing = 1,

    /// <summary>The original container is gone, so the item returned to the root.</summary>
    Rooted = 2,

    /// <summary>
    /// The item cannot exist at a root and its original container is unavailable. The caller
    /// must pick a live destination and ask again.
    /// </summary>
    DestinationRequired = 3,

    /// <summary>
    /// The container the item would return to is itself held by another entry. Restore that
    /// entry first.
    /// </summary>
    BlockedByContainer = 4,

    /// <summary>
    /// The item is made from something that has since been taken away, so nothing would keep it in
    /// step once it was back. It stays held until whatever made it returns.
    /// </summary>
    NoLongerGenerated = 5
}
