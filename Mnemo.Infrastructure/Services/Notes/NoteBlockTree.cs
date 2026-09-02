using System;
using System.Collections.Generic;
using System.Linq;
using Mnemo.Core.Models;

namespace Mnemo.Infrastructure.Services.Notes;

/// <summary>
/// Traversal and addressing helpers over a note's block tree.
/// </summary>
/// <remarks>
/// Blocks are addressed by their sid, the short id minted for the tool boundary, or by any unique
/// prefix of it. A block stored before the sid migration falls back to a prefix of its GUID. This
/// keeps the tokens a small model has to reproduce minimal while staying stable across edits.
/// Resolution walks the whole tree, including nested children such as two-column cells, so edits
/// are not limited to the top-level list.
/// </remarks>
internal static class NoteBlockTree
{
    /// <summary>A block together with the list that contains it and its position within that list.</summary>
    internal readonly record struct Located(Block Block, List<Block> Container, int Index, int Depth);

    /// <summary>
    /// The model-facing handle for a block: its sid, or an 8-character prefix of its id when the
    /// block predates the sid migration.
    /// </summary>
    public static string Handle(Block block) =>
        !string.IsNullOrEmpty(block.Sid) ? block.Sid : (block.Id.Length > 8 ? block.Id[..8] : block.Id);

    /// <summary>Depth-first walk over every block, yielding its container list and index.</summary>
    public static IEnumerable<Located> Walk(List<Block> roots, int depth = 0)
    {
        for (var i = 0; i < roots.Count; i++)
        {
            var b = roots[i];
            yield return new Located(b, roots, i, depth);
            if (b.Children is { Count: > 0 })
            {
                foreach (var child in Walk(b.Children, depth + 1))
                    yield return child;
            }
        }
    }

    /// <summary>
    /// Resolves a block sid, a unique sid prefix, a block id, or a unique id prefix to its location,
    /// tried in that order. Returns false (with <paramref name="ambiguous"/> / <paramref name="candidates"/>)
    /// when nothing matches; ambiguity is reported for the first of those tiers that matched more than
    /// one block, without falling through to a later tier.
    /// </summary>
    public static bool TryLocate(
        List<Block> roots,
        string idOrPrefix,
        out Located located,
        out bool ambiguous,
        out IReadOnlyList<string> candidates)
    {
        located = default;
        ambiguous = false;
        candidates = Array.Empty<string>();

        var key = idOrPrefix?.Trim() ?? string.Empty;
        if (key.Length == 0)
            return false;

        var all = Walk(roots).ToList();

        if (TryTier(all.Where(l => string.Equals(l.Block.Sid, key, StringComparison.OrdinalIgnoreCase)), out located, out ambiguous, out candidates))
            return true;
        if (ambiguous)
            return false;

        if (TryTier(all.Where(l => !string.IsNullOrEmpty(l.Block.Sid) && l.Block.Sid.StartsWith(key, StringComparison.OrdinalIgnoreCase)), out located, out ambiguous, out candidates))
            return true;
        if (ambiguous)
            return false;

        if (TryTier(all.Where(l => string.Equals(l.Block.Id, key, StringComparison.OrdinalIgnoreCase)), out located, out ambiguous, out candidates))
            return true;
        if (ambiguous)
            return false;

        return TryTier(all.Where(l => l.Block.Id.StartsWith(key, StringComparison.OrdinalIgnoreCase)), out located, out ambiguous, out candidates);
    }

    /// <summary>
    /// A single addressing tier: matches this candidate set if there is exactly one, reports
    /// ambiguity if there is more than one, and otherwise leaves both false for the next tier.
    /// </summary>
    private static bool TryTier(
        IEnumerable<Located> matches,
        out Located located,
        out bool ambiguous,
        out IReadOnlyList<string> candidates)
    {
        located = default;
        ambiguous = false;
        candidates = Array.Empty<string>();

        var list = matches.ToList();
        if (list.Count == 1)
        {
            located = list[0];
            return true;
        }

        if (list.Count > 1)
        {
            ambiguous = true;
            candidates = list.Select(l => Handle(l.Block)).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        }

        return false;
    }

    /// <summary>Re-indexes <see cref="Block.Order"/> to 0..n in every list of the tree.</summary>
    public static void NormalizeTree(List<Block> roots)
    {
        var ordered = roots.OrderBy(b => b.Order).ToList();
        for (var i = 0; i < ordered.Count; i++)
        {
            ordered[i].Order = i;
            if (ordered[i].Children is { Count: > 0 })
                NormalizeTree(ordered[i].Children!);
        }

        roots.Clear();
        roots.AddRange(ordered);
    }

    /// <summary>
    /// Sets <see cref="Block.Order"/> to match each block's current position in its list, recursively.
    /// Unlike <see cref="NormalizeTree"/> this does not sort. It treats list position as authoritative,
    /// which is what edit ops mutate.
    /// </summary>
    public static void ReindexByPosition(List<Block> roots)
    {
        for (var i = 0; i < roots.Count; i++)
        {
            roots[i].Order = i;
            if (roots[i].Children is { Count: > 0 })
                ReindexByPosition(roots[i].Children!);
        }
    }

    /// <summary>True for the five heading levels.</summary>
    public static bool IsHeading(BlockType type) =>
        type is BlockType.Heading1 or BlockType.Heading2 or BlockType.Heading3 or BlockType.Heading4;

    /// <summary>Heading rank (1-4); 0 for non-headings. Lower rank = more important.</summary>
    public static int HeadingLevel(BlockType type) => type switch
    {
        BlockType.Heading1 => 1,
        BlockType.Heading2 => 2,
        BlockType.Heading3 => 3,
        BlockType.Heading4 => 4,
        _ => 0
    };
}
