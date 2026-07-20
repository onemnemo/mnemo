using System.Collections.Generic;
using Mnemo.Core.Models;

namespace Mnemo.Core.Identity;

/// <summary>
/// Keeps a note's block sids well-formed and unique within that note. Shared by the backfill and by
/// the commit path so both agree on what a valid block tree looks like — they differ only in how
/// forgiving they are, which is the one thing that should differ.
/// </summary>
public static class BlockSids
{
    /// <summary>
    /// Makes the tree valid, replacing anything unusable. Used by the migration, where the input is
    /// existing user data and refusing it would strand the note.
    /// <para>
    /// Walks in document order; the first block holding a given sid keeps it and later duplicates are
    /// re-minted, so the repair depends only on document order. Minting avoids every well-formed sid
    /// present anywhere in the tree, so repairing an early block cannot take one a later block keeps.
    /// </para>
    /// </summary>
    public static bool Repair(IReadOnlyList<Block>? blocks, SidGenerator sids)
    {
        if (blocks is null || blocks.Count == 0)
            return false;

        var blocked = new HashSet<string>(StringComparer.Ordinal);
        CollectWellFormed(blocks, blocked);

        var claimed = new HashSet<string>(StringComparer.Ordinal);
        var changed = false;
        Walk(blocks);
        return changed;

        void Walk(IReadOnlyList<Block> level)
        {
            foreach (var block in level)
            {
                // Claiming fails for a value an earlier block already kept — the duplicate case.
                if (!Sid.IsWellFormedBlockSid(block.Sid) || !claimed.Add(block.Sid))
                {
                    block.Sid = sids.NextBlockSid(blocked);
                    blocked.Add(block.Sid);
                    claimed.Add(block.Sid);
                    changed = true;
                }

                if (block.Children is { Count: > 0 })
                    Walk(block.Children);
            }
        }
    }

    /// <summary>
    /// Prepares a client-supplied tree for a commit. A block with no sid is new and gets one; a
    /// malformed or duplicated sid is refused, because it means the client's own addressing is
    /// already wrong and quietly rewriting it would hide that while breaking every reference the
    /// client still holds.
    /// </summary>
    /// <returns>Null when the tree is acceptable, otherwise a description of the first problem.</returns>
    public static string? TryPrepareForCommit(IReadOnlyList<Block>? blocks, SidGenerator sids)
    {
        if (blocks is null || blocks.Count == 0)
            return null;

        var blocked = new HashSet<string>(StringComparer.Ordinal);
        CollectWellFormed(blocks, blocked);

        var claimed = new HashSet<string>(StringComparer.Ordinal);
        return Walk(blocks);

        string? Walk(IReadOnlyList<Block> level)
        {
            foreach (var block in level)
            {
                if (string.IsNullOrEmpty(block.Sid))
                {
                    block.Sid = sids.NextBlockSid(blocked);
                    blocked.Add(block.Sid);
                    claimed.Add(block.Sid);
                }
                else if (!Sid.IsWellFormedBlockSid(block.Sid))
                {
                    return $"block sid '{block.Sid}' is not a valid sid";
                }
                else if (!claimed.Add(block.Sid))
                {
                    return $"block sid '{block.Sid}' appears more than once";
                }

                if (block.Children is { Count: > 0 } && Walk(block.Children) is { } problem)
                    return problem;
            }

            return null;
        }
    }

    private static void CollectWellFormed(IReadOnlyList<Block> blocks, HashSet<string> into)
    {
        foreach (var block in blocks)
        {
            if (Sid.IsWellFormedBlockSid(block.Sid))
                into.Add(block.Sid);

            if (block.Children is { Count: > 0 })
                CollectWellFormed(block.Children, into);
        }
    }
}
