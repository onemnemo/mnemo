namespace Mnemo.Core.Models.Trash;

/// <summary>
/// What the trash did with one entry a caller asked to restore.
/// </summary>
/// <param name="EntryId">The entry that was addressed.</param>
/// <param name="Kind">Its source kind, so the caller knows which views to refresh.</param>
/// <param name="ItemId">The restored item's id within that module.</param>
/// <param name="Title">The entry's title snapshot, for the message the caller shows.</param>
/// <param name="Outcome">What happened.</param>
/// <param name="DestinationId">The container the item now sits in, or null for a root.</param>
/// <param name="DestinationName">Display name of that container.</param>
public sealed record TrashRestoreResult(
    string EntryId,
    string Kind,
    string ItemId,
    string Title,
    TrashRestoreOutcome Outcome,
    string? DestinationId = null,
    string? DestinationName = null);
