using System;
using System.Collections.Generic;
using System.Linq;
using Mnemo.Core.Models;

namespace Mnemo.Infrastructure.Services.Notes;

/// <summary>
/// Traversal and addressing helpers over a note's block tree.
/// </summary>
/// <remarks>
/// Blocks are addressed by their full id or by any unique prefix of it (a short id, like a
/// git short SHA). This keeps the tokens a small model has to reproduce minimal while staying
/// stable across edits. Resolution walks the whole tree, including nested children such as
/// two-column cells, so edits are not limited to the top-level list.
/// </remarks>
internal static class NoteBlockTree
{
    /// <summary>A block together with the list that contains it and its position within that list.</summary>
    internal readonly record struct Located(Block Block, List<Block> Container, int Index, int Depth);

    /// <summary>Short, human/model-friendly form of a block id.</summary>
    public static string ShortId(string id) =>
        string.IsNullOrEmpty(id) ? string.Empty : (id.Length > 8 ? id[..8] : id);

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
    /// Resolves a block id or short-id prefix to its location. Exact id matches win; otherwise a
    /// single prefix match is accepted. Returns false (with <paramref name="ambiguous"/> /
    /// <paramref name="candidates"/>) when nothing matches or the prefix is not unique.
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

        var exact = all.Where(l => string.Equals(l.Block.Id, key, StringComparison.OrdinalIgnoreCase)).ToList();
        if (exact.Count == 1)
        {
            located = exact[0];
            return true;
        }

        var prefix = all
            .Where(l => l.Block.Id.StartsWith(key, StringComparison.OrdinalIgnoreCase))
            .ToList();

        if (prefix.Count == 1)
        {
            located = prefix[0];
            return true;
        }

        if (prefix.Count > 1)
        {
            ambiguous = true;
            candidates = prefix.Select(l => ShortId(l.Block.Id)).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
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
