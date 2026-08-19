namespace Mnemo.Core.Models.Trash;

/// <summary>
/// The lifecycle position of one trash ledger row.
/// </summary>
public enum TrashEntryState
{
    /// <summary>
    /// The ledger row exists and the owning source may not have marked its rows yet.
    /// Prepared rows are invisible to listings and are resolved by reconciliation.
    /// </summary>
    Prepared = 0,

    /// <summary>
    /// The source committed its marks. Only held rows appear in listings and the badge count.
    /// </summary>
    Held = 1,

    /// <summary>
    /// Permanent deletion began. A purging row is retried until it succeeds and is never
    /// released back to live data.
    /// </summary>
    Purging = 2
}
