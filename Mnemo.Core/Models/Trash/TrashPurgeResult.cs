using System.Collections.Generic;

namespace Mnemo.Core.Models.Trash;

/// <summary>
/// What the trash did with one entry a caller asked to destroy.
/// </summary>
/// <param name="EntryId">The entry that was addressed.</param>
/// <param name="Title">The entry's title snapshot, for the message the caller shows.</param>
/// <param name="Purged">True when the entry and its rows are gone.</param>
/// <param name="BlockingEntryIds">
/// Other entries that own rows inside this one's cascade. They must be restored or purged
/// before this entry can be destroyed.
/// </param>
public sealed record TrashPurgeResult(
    string EntryId,
    string Title,
    bool Purged,
    IReadOnlyList<string> BlockingEntryIds);
