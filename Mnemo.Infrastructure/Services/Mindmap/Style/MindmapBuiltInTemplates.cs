using System.Collections.Generic;
using System.Linq;
using Mnemo.Core.Models.Mindmap;

namespace Mnemo.Infrastructure.Services.Mindmap.Style;

/// <summary>
/// The style templates shipped with the module. These are the fallback library when a document
/// references no user template; the document default is <see cref="DefaultId"/>. User templates live in
/// storage and layer above these by id.
/// </summary>
public static class MindmapBuiltInTemplates
{
    /// <summary>Id of the built-in used when a document sets no default template.</summary>
    public const string DefaultId = "dawn-classic";

    /// <summary>Accent root over warm neutrals; the module's out-of-the-box look.</summary>
    public static StyleTemplate DawnClassic { get; } = new()
    {
        Id = "dawn-classic",
        Name = "Dawn Classic",
        RootStyle = new ElementStyle
        {
            Fill = MindmapStyleTokens.Accent,
            TextColor = MindmapStyleTokens.OnAccent,
            NodeShape = NodeShape.Card,
            FontScale = FontScale.L,
        },
        DepthRules = new[]
        {
            new DepthRule { MinDepth = 1, MaxDepth = 1, Style = new ElementStyle { NodeShape = NodeShape.Card, FontScale = FontScale.M } },
            new DepthRule { MinDepth = 2, Style = new ElementStyle { NodeShape = NodeShape.Plain, FontScale = FontScale.S } },
        },
        BranchColors = BranchColorMode.None,
    };

    /// <summary>A distinct palette color per depth-1 branch, inherited down.</summary>
    public static StyleTemplate RainbowBranches { get; } = new()
    {
        Id = "rainbow-branches",
        Name = "Rainbow Branches",
        RootStyle = new ElementStyle
        {
            Fill = MindmapStyleTokens.Accent,
            TextColor = MindmapStyleTokens.OnAccent,
            NodeShape = NodeShape.Card,
            FontScale = FontScale.L,
        },
        DepthRules = new[]
        {
            new DepthRule { MinDepth = 1, Style = new ElementStyle { NodeShape = NodeShape.Pill } },
        },
        BranchColors = BranchColorMode.ByBranch,
    };

    /// <summary>Neutral throughout — outline branches, no color.</summary>
    public static StyleTemplate Monochrome { get; } = new()
    {
        Id = "monochrome",
        Name = "Monochrome",
        RootStyle = new ElementStyle
        {
            Fill = MindmapStyleTokens.SurfaceAlt,
            TextColor = MindmapStyleTokens.TextPrimary,
            Stroke = MindmapStyleTokens.Stroke,
            NodeShape = NodeShape.Card,
            FontScale = FontScale.L,
        },
        DepthRules = new[]
        {
            new DepthRule { MinDepth = 1, Style = new ElementStyle { NodeShape = NodeShape.Outline, TextColor = MindmapStyleTokens.TextPrimary } },
        },
        BranchColors = BranchColorMode.None,
    };

    /// <summary>Large type and generous spacing for study maps.</summary>
    public static StyleTemplate Study { get; } = new()
    {
        Id = "study",
        Name = "Study",
        RootStyle = new ElementStyle
        {
            Fill = MindmapStyleTokens.Accent,
            TextColor = MindmapStyleTokens.OnAccent,
            NodeShape = NodeShape.Card,
            FontScale = FontScale.XL,
        },
        DepthRules = new[]
        {
            new DepthRule { MinDepth = 1, MaxDepth = 1, Style = new ElementStyle { NodeShape = NodeShape.Card, FontScale = FontScale.L } },
            new DepthRule { MinDepth = 2, Style = new ElementStyle { NodeShape = NodeShape.Pill, FontScale = FontScale.M } },
        },
        BranchColors = BranchColorMode.ByBranch,
        LayoutDefaults = new LayoutOptions { NodeSpacing = 32, RankSpacing = 120 },
    };

    /// <summary>Uniform cards with orthogonal connectors.</summary>
    public static StyleTemplate OrgChart { get; } = new()
    {
        Id = "org-chart",
        Name = "Org Chart",
        RootStyle = new ElementStyle
        {
            Fill = MindmapStyleTokens.Accent,
            TextColor = MindmapStyleTokens.OnAccent,
            NodeShape = NodeShape.Card,
            FontScale = FontScale.L,
        },
        DepthRules = new[]
        {
            new DepthRule { MinDepth = 1, Style = new ElementStyle { NodeShape = NodeShape.Card } },
        },
        BranchColors = BranchColorMode.None,
        EdgeDefaults = new EdgeStyle { Routing = EdgeRouting.Orthogonal, Line = LineStyle.Solid },
    };

    /// <summary>Outline shapes with dashed links.</summary>
    public static StyleTemplate Blueprint { get; } = new()
    {
        Id = "blueprint",
        Name = "Blueprint",
        RootStyle = new ElementStyle
        {
            Fill = MindmapStyleTokens.Surface,
            TextColor = MindmapStyleTokens.TextPrimary,
            Stroke = MindmapStyleTokens.Accent,
            NodeShape = NodeShape.Outline,
            FontScale = FontScale.L,
        },
        DepthRules = new[]
        {
            new DepthRule { MinDepth = 1, Style = new ElementStyle { NodeShape = NodeShape.Outline, Stroke = MindmapStyleTokens.Stroke } },
        },
        BranchColors = BranchColorMode.None,
        EdgeDefaults = new EdgeStyle { Line = LineStyle.Dashed, Routing = EdgeRouting.Curve },
    };

    private static readonly IReadOnlyList<StyleTemplate> _all = new[]
    {
        DawnClassic, RainbowBranches, Monochrome, Study, OrgChart, Blueprint,
    };

    private static readonly IReadOnlyDictionary<string, StyleTemplate> _byId = _all.ToDictionary(t => t.Id);

    /// <summary>All shipped templates, in gallery order.</summary>
    public static IReadOnlyList<StyleTemplate> All => _all;

    /// <summary>The default template used when a document sets no default.</summary>
    public static StyleTemplate Default => DawnClassic;

    /// <summary>Look up a built-in by id; null if none matches.</summary>
    public static StyleTemplate? ById(string? id) => id is not null && _byId.TryGetValue(id, out var template) ? template : null;
}
