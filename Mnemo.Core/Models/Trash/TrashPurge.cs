using System.Collections.Generic;

namespace Mnemo.Core.Models.Trash;

/// <summary>
/// A source's answer to one purge request.
/// </summary>
/// <param name="Completed">True when the source no longer holds the entry and its rows are gone.</param>
/// <param name="BlockingEntryIds">
/// Entries whose rows a foreign key cascade would have destroyed. When this is not empty the
/// source performed no mutation, and the blocking entries must be restored or purged first.
/// </param>
public sealed record TrashPurge(bool Completed, IReadOnlyList<string> BlockingEntryIds)
{
    /// <summary>The entry's rows are gone.</summary>
    public static TrashPurge Done() => new(true, []);

    /// <summary>Nothing was deleted, because other entries own rows in the same cascade.</summary>
    public static TrashPurge Blocked(IReadOnlyList<string> blockingEntryIds) => new(false, blockingEntryIds);
}
