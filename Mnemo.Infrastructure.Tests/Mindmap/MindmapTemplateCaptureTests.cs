using System.Collections.Generic;
using System.Linq;
using Mnemo.Core.Models.Mindmap;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Mindmap;

/// <summary>
/// Depth-band capture: turning a styled subtree into a <see cref="StyleTemplate"/> whose root style plus
/// per-depth rules reproduce the look level by level. Pure over the document, so these assert which
/// overrides land in which band rather than any rendering.
/// </summary>
public sealed class MindmapTemplateCaptureTests
{
    private static readonly ElementStyle Pill = new() { NodeShape = NodeShape.Pill };
    private static readonly ElementStyle Outline = new() { NodeShape = NodeShape.Outline };
    private static readonly ElementStyle Accent = new() { Fill = MindmapStyleTokens.Accent };

    private static MindmapElement Node(string id, ElementStyle? style = null) =>
        new() { Id = id, Kind = ElementKind.Node, Content = new TextContent { Text = id }, Style = style };

    private static MindmapDocument Doc(IEnumerable<MindmapElement> nodes, params (string From, string To)[] edges) =>
        new()
        {
            Id = "m",
            Elements = nodes.ToList(),
            Edges = edges
                .Select((e, i) => new MindmapEdge { Id = $"e{i}", FromId = e.From, ToId = e.To, Kind = EdgeKind.Hierarchy })
                .ToList(),
        };

    [Fact]
    public void AvailableLevels_NoOverrides_ReturnsZero()
    {
        var doc = Doc(new[] { Node("r"), Node("a") }, ("r", "a"));

        Assert.Equal(0, MindmapTemplateCapture.AvailableLevels(doc, "r"));
    }

    [Fact]
    public void AvailableLevels_RootOnly_ReturnsOne()
    {
        var doc = Doc(new[] { Node("r", Accent), Node("a") }, ("r", "a"));

        Assert.Equal(1, MindmapTemplateCapture.AvailableLevels(doc, "r"));
    }

    [Fact]
    public void AvailableLevels_CountsToDeepestOverriddenDepth()
    {
        // depth 1 is unstyled, but depth 2 carries an override, so all three levels are available.
        var doc = Doc(
            new[] { Node("r", Accent), Node("a"), Node("b", Pill) },
            ("r", "a"), ("a", "b"));

        Assert.Equal(3, MindmapTemplateCapture.AvailableLevels(doc, "r"));
    }

    [Fact]
    public void Capture_RootOnly_ProducesRootStyleAndNoDepthRules()
    {
        var doc = Doc(new[] { Node("r", Accent), Node("a", Pill) }, ("r", "a"));

        var template = MindmapTemplateCapture.Capture(doc, "r", "user-1", "T", levels: 1);

        Assert.Equal(Accent, template.RootStyle);
        Assert.Empty(template.DepthRules);
    }

    [Fact]
    public void Capture_RecordsOneSingleDepthBandPerLevel()
    {
        var doc = Doc(
            new[] { Node("r", Accent), Node("a", Pill), Node("b", Outline) },
            ("r", "a"), ("a", "b"));

        var template = MindmapTemplateCapture.Capture(doc, "r", "user-1", "T", levels: 3);

        Assert.Equal(Accent, template.RootStyle);
        Assert.Collection(template.DepthRules,
            r => { Assert.Equal(1, r.MinDepth); Assert.Equal(1, r.MaxDepth); Assert.Equal(Pill, r.Style); },
            r => { Assert.Equal(2, r.MinDepth); Assert.Equal(2, r.MaxDepth); Assert.Equal(Outline, r.Style); });
    }

    [Fact]
    public void Capture_LevelsLimitsCapturedDepth()
    {
        var doc = Doc(
            new[] { Node("r", Accent), Node("a", Pill), Node("b", Outline) },
            ("r", "a"), ("a", "b"));

        var template = MindmapTemplateCapture.Capture(doc, "r", "user-1", "T", levels: 2);

        // Two levels means root plus depth 1 only; the depth-2 override is left out.
        var rule = Assert.Single(template.DepthRules);
        Assert.Equal(1, rule.MinDepth);
        Assert.Equal(Pill, rule.Style);
    }

    [Fact]
    public void Capture_UsesMostCommonOverridePerDepth()
    {
        // Two depth-1 siblings share Pill, one uses Outline, so the band captures Pill.
        var doc = Doc(
            new[] { Node("r", Accent), Node("a", Pill), Node("b", Pill), Node("c", Outline) },
            ("r", "a"), ("r", "b"), ("r", "c"));

        var template = MindmapTemplateCapture.Capture(doc, "r", "user-1", "T", levels: 2);

        var rule = Assert.Single(template.DepthRules);
        Assert.Equal(Pill, rule.Style);
    }

    [Fact]
    public void Capture_SkipsDepthsWithNoOverrides()
    {
        // depth 1 is unstyled; only the depth-2 override should produce a rule.
        var doc = Doc(
            new[] { Node("r", Accent), Node("a"), Node("b", Outline) },
            ("r", "a"), ("a", "b"));

        var template = MindmapTemplateCapture.Capture(doc, "r", "user-1", "T", levels: 3);

        var rule = Assert.Single(template.DepthRules);
        Assert.Equal(2, rule.MinDepth);
        Assert.Equal(Outline, rule.Style);
    }

    [Fact]
    public void Capture_RootWithoutOverride_LeavesRootStyleNull()
    {
        var doc = Doc(new[] { Node("r"), Node("a", Pill) }, ("r", "a"));

        var template = MindmapTemplateCapture.Capture(doc, "r", "user-1", "T", levels: 2);

        Assert.Null(template.RootStyle);
        Assert.Equal(Pill, Assert.Single(template.DepthRules).Style);
    }

    [Fact]
    public void Capture_DepthsAreRelativeToTheSelectedNode()
    {
        // Selecting a mid-tree node makes it depth 0; the branch above and to the side is ignored.
        var doc = Doc(
            new[] { Node("r", Accent), Node("mid", Pill), Node("leaf", Outline), Node("other", Accent) },
            ("r", "mid"), ("mid", "leaf"), ("r", "other"));

        var available = MindmapTemplateCapture.AvailableLevels(doc, "mid");
        var template = MindmapTemplateCapture.Capture(doc, "mid", "user-1", "T", levels: available);

        Assert.Equal(2, available);
        Assert.Equal(Pill, template.RootStyle);
        var rule = Assert.Single(template.DepthRules);
        Assert.Equal(1, rule.MinDepth);
        Assert.Equal(Outline, rule.Style);
    }
}
