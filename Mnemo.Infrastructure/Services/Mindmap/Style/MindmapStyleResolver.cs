using System;
using System.Collections.Generic;
using Mnemo.Core.Models.Mindmap;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Services.Mindmap.Style;

/// <summary>
/// The style cascade. Per property, the first non-null value wins walking element overrides, then
/// each template's root/depth rule in chain order. Branch coloring fills the stroke of depth-≥1 nodes when
/// a chain template opts in; anything still unset falls back to a neutral theme token.
/// </summary>
public sealed class MindmapStyleResolver : IMindmapStyleResolver
{
    /// <summary>The fills that are the canvas's own paper rather than a colour laid on it.</summary>
    private static readonly HashSet<string> PaperFills = new(StringComparer.Ordinal)
    {
        MindmapStyleTokens.Surface,
        MindmapStyleTokens.SurfaceAlt,
        MindmapStyleTokens.Stroke,
    };

    public ResolvedStyle Resolve(ElementStyle? own, StyleContext context, IReadOnlyList<StyleTemplate> templateChain)
    {
        var chain = templateChain ?? Array.Empty<StyleTemplate>();

        string? fill = own?.Fill;
        string? stroke = own?.Stroke;
        string? text = own?.TextColor;
        FontScale? font = own?.FontScale;
        NodeShape? shape = own?.NodeShape;
        string? icon = own?.Icon;

        // Branch color is a function of the branch index alone; any ByBranch template in the chain enables it.
        string? branchColor = null;
        var branchColored = context.Depth >= 1 && context.BranchIndex >= 0;
        if (branchColored)
        {
            foreach (var template in chain)
            {
                if (template.BranchColors == BranchColorMode.ByBranch)
                {
                    branchColor = MindmapStyleTokens.Palette((context.BranchIndex % MindmapStyleTokens.PaletteSize) + 1);
                    break;
                }
            }
        }

        // Template rules apply only to hierarchy elements; free elements keep their own style + theme defaults.
        if (context.Depth >= 0)
        {
            foreach (var template in chain)
            {
                var rule = context.IsRoot ? template.RootStyle : DepthRuleStyle(template, context.Depth);

                fill ??= rule?.Fill;
                text ??= rule?.TextColor;
                font ??= rule?.FontScale;
                shape ??= rule?.NodeShape;
                icon ??= rule?.Icon;

                // An explicit stroke in this template's rule beats its automatic branch color.
                var templateStroke = rule?.Stroke;
                if (templateStroke is null && branchColor is not null && template.BranchColors == BranchColorMode.ByBranch)
                    templateStroke = branchColor;
                stroke ??= templateStroke;
            }
        }

        if (branchColor is not null)
            stroke ??= branchColor;

        // A root card paints its fill, so a stroke chosen for the root is meant as that fill and
        // replaces any colour fill, whether the template or the element itself named it. A paper
        // fill is not a colour and keeps the ring. Only on the card: a pill washes over its fill and
        // the other rungs paint none, so there the fill stays the accent the ink was paired with.
        if (context.IsRoot
            && own?.Stroke is not null
            && (shape ?? NodeShape.Card) == NodeShape.Card
            && fill is not null
            && !PaperFills.Contains(fill))
        {
            fill = own.Stroke;
        }

        return new ResolvedStyle
        {
            Fill = fill ?? MindmapStyleTokens.Surface,
            Stroke = stroke ?? MindmapStyleTokens.Stroke,
            TextColor = text ?? MindmapStyleTokens.TextPrimary,
            FontScale = font ?? FontScale.M,
            NodeShape = shape ?? NodeShape.Card,
            Icon = icon,
            BranchColor = branchColor,
        };
    }

    private static ElementStyle? DepthRuleStyle(StyleTemplate template, int depth)
    {
        foreach (var rule in template.DepthRules)
        {
            if (depth >= rule.MinDepth && (rule.MaxDepth is null || depth <= rule.MaxDepth))
                return rule.Style;
        }
        return null;
    }
}
