using System;
using System.Collections.Generic;
using System.Linq;

namespace Mnemo.Core.Models.Mindmap;

/// <summary>
/// Turns a styled subtree into a reusable <see cref="StyleTemplate"/>. Walking down from a chosen node
/// (treated as the template root), each depth band records a representative style drawn from the node
/// overrides actually present at that depth, so a saved template reproduces the look level by level rather
/// than only cloning the root.
/// </summary>
public static class MindmapTemplateCapture
{
    /// <summary>
    /// How many depth levels under <paramref name="rootId"/> are worth capturing: one past the deepest node
    /// that carries a style override (the root itself is level 1). Zero when nothing in the subtree is styled.
    /// </summary>
    public static int AvailableLevels(MindmapDocument document, string rootId)
    {
        ArgumentNullException.ThrowIfNull(document);
        var byDepth = OverridesByDepth(document, rootId);
        return byDepth.Count == 0 ? 0 : byDepth.Keys.Max() + 1;
    }

    /// <summary>
    /// Captures the first <paramref name="levels"/> depth bands of the subtree rooted at
    /// <paramref name="rootId"/> into a template. The root's override becomes the root style; each deeper
    /// level contributes a single-depth <see cref="DepthRule"/> holding the most common override seen at that
    /// depth. Levels with no overrides are skipped. A single-depth band (rather than an open-ended one) keeps
    /// the restore faithful: a deeper target map only receives the styles that were actually captured.
    /// </summary>
    public static StyleTemplate Capture(MindmapDocument document, string rootId, string id, string name, int levels)
    {
        ArgumentNullException.ThrowIfNull(document);
        ArgumentException.ThrowIfNullOrEmpty(id);
        ArgumentException.ThrowIfNullOrEmpty(name);

        var byDepth = OverridesByDepth(document, rootId);
        var available = byDepth.Count == 0 ? 0 : byDepth.Keys.Max() + 1;
        levels = Math.Clamp(levels, 1, Math.Max(1, available));

        // The root is the single selected node, so at most one override sits at depth 0.
        var rootStyle = byDepth.TryGetValue(0, out var atRoot) ? atRoot[0] : null;

        var rules = new List<DepthRule>();
        for (var depth = 1; depth < levels; depth++)
        {
            if (byDepth.TryGetValue(depth, out var overrides) && overrides.Count > 0)
                rules.Add(new DepthRule { MinDepth = depth, MaxDepth = depth, Style = MostCommon(overrides) });
        }

        return new StyleTemplate
        {
            Id = id,
            Name = name,
            RootStyle = rootStyle,
            DepthRules = rules,
        };
    }

    // Collects the non-null node overrides at each depth relative to rootId (root = 0), in pre-order so
    // ties in MostCommon fall to the style seen first.
    private static Dictionary<int, List<ElementStyle>> OverridesByDepth(MindmapDocument document, string rootId)
    {
        var result = new Dictionary<int, List<ElementStyle>>();
        var styleById = document.Elements
            .Where(e => e.Kind == ElementKind.Node)
            .ToDictionary(e => e.Id, e => e.Style);
        if (!styleById.ContainsKey(rootId))
            return result;

        var childrenOf = new Dictionary<string, List<string>>();
        foreach (var edge in document.Edges.Where(e =>
                     e.Kind == EdgeKind.Hierarchy && styleById.ContainsKey(e.FromId) && styleById.ContainsKey(e.ToId)))
        {
            if (!childrenOf.TryGetValue(edge.FromId, out var kids))
            {
                kids = new List<string>();
                childrenOf[edge.FromId] = kids;
            }
            kids.Add(edge.ToId);
        }

        void Walk(string id, int depth)
        {
            if (styleById.TryGetValue(id, out var style) && style is not null)
            {
                if (!result.TryGetValue(depth, out var list))
                {
                    list = new List<ElementStyle>();
                    result[depth] = list;
                }
                list.Add(style);
            }
            if (childrenOf.TryGetValue(id, out var kids))
                foreach (var kid in kids)
                    Walk(kid, depth + 1);
        }

        Walk(rootId, 0);
        return result;
    }

    // Value equality on the immutable ElementStyle groups identical overrides; the most frequent wins, and
    // OrderByDescending is stable so an earliest-seen tie holds.
    private static ElementStyle MostCommon(List<ElementStyle> styles) =>
        styles.GroupBy(s => s)
            .OrderByDescending(g => g.Count())
            .First()
            .Key;
}
