namespace Mnemo.Core.Models.Trash;

/// <summary>
/// One held entry as the trash page sees it.
/// </summary>
/// <param name="Entry">The ledger row.</param>
/// <param name="SourceAvailable">
/// False when no source in this build claims the entry's kind. Such an entry is preserved and
/// shown as unavailable rather than discarded, restored, or purged without its owner.
/// </param>
public sealed record TrashListing(TrashEntry Entry, bool SourceAvailable);
