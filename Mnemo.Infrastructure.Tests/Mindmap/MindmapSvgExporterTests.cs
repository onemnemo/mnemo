using System;
using System.Collections.Generic;
using System.IO;
using Avalonia;
using Mnemo.Core.Models.Mindmap;
using Mnemo.UI.Modules.Mindmap.Views;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Mindmap;

/// <summary>
/// Covers the pure SVG emitter: shape/kind coverage, edge dash + cap emission, base64 image embedding,
/// and deterministic output. Builds theme-resolved snapshots directly, so no Avalonia rendering is needed.
/// </summary>
public sealed class MindmapSvgExporterTests
{
    private static MindmapSvgNode Node(ElementKind kind, string contentType, double x, double y) => new()
    {
        Kind = kind,
        ContentType = contentType,
        X = x,
        Y = y,
        Width = 120,
        Height = 40,
        FillColor = "#112233",
        StrokeColor = "#445566",
        TextColor = "#778899",
    };

    private static MindmapSvgScene SceneOf(IReadOnlyList<MindmapSvgNode> nodes, IReadOnlyList<MindmapSvgEdge>? edges = null) => new()
    {
        Bounds = new Rect(0, 0, 1000, 800),
        BackgroundColor = "#FAFAFA",
        Nodes = nodes,
        Edges = edges ?? Array.Empty<MindmapSvgEdge>(),
    };

    [Fact]
    public void Emit_WrapsContentInSizedSvgWithBackground()
    {
        var svg = MindmapSvgExporter.Emit(SceneOf(new[] { Node(ElementKind.Node, ElementContentDiscriminators.Text, 10, 10) with { Text = "Root", IsRoot = true } }));

        Assert.StartsWith("<?xml", svg);
        Assert.Contains("<svg", svg);
        Assert.Contains("viewBox=\"0 0 1000 800\"", svg);
        Assert.Contains("fill=\"#FAFAFA\"", svg); // opaque background rect
        Assert.EndsWith("</svg>\n", svg);
        Assert.Contains("font-weight=\"600\"", svg); // root label is bold
    }

    [Fact]
    public void Emit_CoversEveryNodeShapeAndKind()
    {
        var nodes = new List<MindmapSvgNode>
        {
            Node(ElementKind.Node, ElementContentDiscriminators.Text, 0, 0) with { Shape = NodeShape.Card, Text = "Card" },
            Node(ElementKind.Node, ElementContentDiscriminators.Text, 0, 60) with { Shape = NodeShape.Pill, Text = "Pill" },
            Node(ElementKind.Node, ElementContentDiscriminators.Text, 0, 120) with { Shape = NodeShape.Outline, Text = "Outline" },
            Node(ElementKind.Node, ElementContentDiscriminators.Text, 0, 180) with { Shape = NodeShape.Plain, Text = "Plain" },
            Node(ElementKind.Shape, ElementContentDiscriminators.Shape, 200, 0) with { FreeShape = ShapeType.Ellipse },
            Node(ElementKind.Shape, ElementContentDiscriminators.Shape, 200, 60) with { FreeShape = ShapeType.Diamond },
            Node(ElementKind.Shape, ElementContentDiscriminators.Shape, 200, 120) with { FreeShape = ShapeType.Hexagon },
            Node(ElementKind.Shape, ElementContentDiscriminators.Shape, 200, 180) with { FreeShape = ShapeType.Parallelogram },
            Node(ElementKind.Shape, ElementContentDiscriminators.Shape, 200, 240) with { FreeShape = ShapeType.Line },
            Node(ElementKind.Shape, ElementContentDiscriminators.Shape, 200, 300) with { FreeShape = ShapeType.Arrow },
            Node(ElementKind.Node, ElementContentDiscriminators.Task, 400, 0) with { Text = "Do it", IsTaskDone = true },
            Node(ElementKind.Node, ElementContentDiscriminators.Code, 400, 60) with { Text = "line1\nline2", CodeLanguage = "python", Height = 80 },
            Node(ElementKind.Node, ElementContentDiscriminators.Math, 400, 160) with { Text = "x^2" },
            Node(ElementKind.Node, ElementContentDiscriminators.Link, 400, 220) with { Text = "Site" },
            Node(ElementKind.Node, ElementContentDiscriminators.Note, 400, 280) with { Text = "My note" },
            Node(ElementKind.Node, ElementContentDiscriminators.Flashcard, 400, 340) with { Text = "Deck", RefBadge = "3 due" },
            Node(ElementKind.Frame, ElementContentDiscriminators.Frame, 600, 0) with { Text = "Frame", Width = 300, Height = 200 },
            Node(ElementKind.Text, ElementContentDiscriminators.FreeText, 600, 240) with { Text = "Floating text" },
        };

        var svg = MindmapSvgExporter.Emit(SceneOf(nodes));

        Assert.Contains("<ellipse", svg);
        Assert.Contains("<polygon", svg);   // diamond / hexagon / parallelogram
        Assert.Contains("<line", svg);       // line + arrow shapes
        Assert.Contains("rx=\"20\"", svg);   // pill stadium radius = height / 2
        Assert.Contains("font-style=\"italic\"", svg); // math falls back to italic raw text
        Assert.Contains("x^2", svg);
        Assert.Contains("<tspan", svg);      // multi-line code lines
        Assert.Contains("python", svg);      // code language chip
        Assert.Contains("text-decoration=\"line-through\"", svg); // completed task strike
        Assert.Contains("3 due", svg);       // ref badge
        Assert.Contains("fill-opacity=\"0.3\"", svg); // translucent frame fill
        Assert.Contains("'Geist Mono'", svg); // code uses the mono font
        Assert.Contains("Floating text", svg);
    }

    [Fact]
    public void Emit_EmitsHierarchyBezierAndLinkPolyline()
    {
        var edges = new List<MindmapSvgEdge>
        {
            new()
            {
                IsHierarchy = true,
                Points = new[] { new Point(0, 0), new Point(50, 0), new Point(50, 100), new Point(100, 100) },
                Color = "#334455",
            },
            new()
            {
                IsHierarchy = false,
                Points = new[] { new Point(0, 0), new Point(60, 40), new Point(120, 80) },
                Color = "#AA0000",
                Thickness = 2,
            },
        };

        var svg = MindmapSvgExporter.Emit(SceneOf(Array.Empty<MindmapSvgNode>(), edges));

        Assert.Contains("M 0 0 C 50 0 50 100 100 100", svg); // hierarchy cubic
        Assert.Contains("stroke=\"#334455\"", svg);
        Assert.Contains("M 0 0 L 60 40 L 120 80", svg);       // link polyline
        Assert.Contains("stroke=\"#AA0000\"", svg);
    }

    [Fact]
    public void Emit_EmitsDashArraysAndCaps()
    {
        var edges = new List<MindmapSvgEdge>
        {
            new()
            {
                IsHierarchy = false,
                Points = new[] { new Point(0, 0), new Point(100, 0) },
                LineStyle = LineStyle.Dashed,
                Thickness = 2,
                EndCap = ArrowCap.Arrow,
                EndDirection = new Point(1, 0),
            },
            new()
            {
                IsHierarchy = false,
                Points = new[] { new Point(0, 50), new Point(100, 50) },
                LineStyle = LineStyle.Dotted,
                Thickness = 1,
                StartCap = ArrowCap.Dot,
                StartDirection = new Point(-1, 0),
            },
            new()
            {
                IsHierarchy = false,
                Points = new[] { new Point(0, 100), new Point(100, 100) },
                LineStyle = LineStyle.Double,
                Thickness = 2,
            },
        };

        var svg = MindmapSvgExporter.Emit(SceneOf(Array.Empty<MindmapSvgNode>(), edges));

        Assert.Contains("stroke-dasharray=\"8 6\"", svg); // dashed: {4,3} * thickness 2
        Assert.Contains("stroke-dasharray=\"1 2\"", svg); // dotted: {1,2} * thickness 1
        Assert.Contains("<circle", svg);                  // dot cap

        // Double style draws two parallel strokes (offset polylines), neither dashed.
        var doublePaths = CountOccurrences(svg, "M 0 100");
        Assert.Equal(0, doublePaths); // both strokes are offset off the centerline
        Assert.Contains("<path d=\"M ", svg);
    }

    [Fact]
    public void Emit_EmbedsImageAsBase64DataUri()
    {
        var path = Path.Combine(Path.GetTempPath(), $"mm_svg_{Guid.NewGuid():N}.png");
        File.WriteAllBytes(path, new byte[] { 1, 2, 3, 4, 5 });
        try
        {
            var node = Node(ElementKind.Image, ElementContentDiscriminators.CanvasImage, 0, 0) with { AssetPath = path, Width = 200, Height = 150 };
            var svg = MindmapSvgExporter.Emit(SceneOf(new[] { node }));

            Assert.Contains("<image", svg);
            Assert.Contains("data:image/png;base64,", svg);
            Assert.Contains(Convert.ToBase64String(new byte[] { 1, 2, 3, 4, 5 }), svg);
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public void Emit_FallsBackToPlaceholderForMissingImage()
    {
        var node = Node(ElementKind.Image, ElementContentDiscriminators.CanvasImage, 0, 0) with
        {
            AssetPath = Path.Combine(Path.GetTempPath(), $"missing_{Guid.NewGuid():N}.png"),
        };
        var scene = SceneOf(new[] { node }) with { MissingImageLabel = "Missing image" };

        var svg = MindmapSvgExporter.Emit(scene);

        Assert.DoesNotContain("data:image", svg);
        Assert.Contains("Missing image", svg);
    }

    [Fact]
    public void Emit_EscapesMarkupInLabels()
    {
        var node = Node(ElementKind.Node, ElementContentDiscriminators.Text, 0, 0) with { Text = "a<b> & \"c\"" };
        var svg = MindmapSvgExporter.Emit(SceneOf(new[] { node }));

        Assert.Contains("a&lt;b&gt; &amp; &quot;c&quot;", svg);
        Assert.DoesNotContain("<b>", svg);
    }

    [Fact]
    public void Emit_IsDeterministic()
    {
        var nodes = new[]
        {
            Node(ElementKind.Node, ElementContentDiscriminators.Text, 0, 0) with { Text = "One", Shape = NodeShape.Pill },
            Node(ElementKind.Node, ElementContentDiscriminators.Task, 0, 60) with { Text = "Two", IsTaskDone = false },
        };
        var edges = new[]
        {
            new MindmapSvgEdge { IsHierarchy = true, Points = new[] { new Point(0, 0), new Point(10, 0), new Point(10, 60), new Point(0, 60) } },
        };

        var first = MindmapSvgExporter.Emit(SceneOf(nodes, edges));
        var second = MindmapSvgExporter.Emit(SceneOf(nodes, edges));

        Assert.Equal(first, second);
    }

    private static int CountOccurrences(string haystack, string needle)
    {
        var count = 0;
        var index = 0;
        while ((index = haystack.IndexOf(needle, index, StringComparison.Ordinal)) >= 0)
        {
            count++;
            index += needle.Length;
        }
        return count;
    }
}
