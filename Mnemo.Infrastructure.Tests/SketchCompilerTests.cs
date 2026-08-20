using System.Linq;
using Mnemo.Core.Sketch;

namespace Mnemo.Infrastructure.Tests;

public class SketchCompilerTests
{
    [Fact]
    public void Resolve_CreatesImplicitNodesAndLabeledEdge()
    {
        var diagram = new SketchCompiler().Resolve("""
            A -> B
            B -> C : depends on
            """);

        Assert.DoesNotContain(diagram.Diagnostics, d => d.Severity == SketchDiagnosticSeverity.Error);
        Assert.Equal(new[] { "A", "B", "C" }, diagram.Nodes.Select(n => n.Id).ToArray());
        Assert.Equal(2, diagram.Edges.Count);
        Assert.Equal("depends on", diagram.Edges[1].Label);
    }

    [Fact]
    public void CompileToSvg_RendersNodesEdgesAndEscapesLabels()
    {
        var result = new SketchCompiler().CompileToSvg("""
            A -> B : "uses <api>"
            """);

        Assert.Contains("<svg", result.Svg);
        Assert.Contains("node:A", result.Svg);
        Assert.Contains("node:B", result.Svg);
        Assert.Contains("uses &lt;api&gt;", result.Svg);
    }

    [Fact]
    public void Layout_SizesAndWrapsLongNodeLabels()
    {
        var result = new SketchCompiler().CompileToSvg("""
            NodeA "This label is long enough to wrap inside the node"
            NodeB "Short"
            NodeA -> NodeB
            """);

        var diagram = new SketchCompiler().Layout("""
            NodeA "This label is long enough to wrap inside the node"
            NodeB "Short"
            NodeA -> NodeB
            """);
        var nodeA = diagram.Nodes.Single(n => n.Id == "NodeA");
        var nodeB = diagram.Nodes.Single(n => n.Id == "NodeB");

        Assert.True(nodeA.Width > nodeB.Width);
        Assert.True(nodeA.Height > nodeB.Height);
        Assert.True(nodeA.LabelLines.Count > 1);
        Assert.Contains("This label is long enough", result.Svg);
        Assert.Contains("wrap inside the node", result.Svg);
    }

    [Fact]
    public void Resolve_AllowsBracketNodesLabelsCommentsAndPropertyBlocks()
    {
        var diagram = new SketchCompiler().Resolve("""
            # comment
            sketch {
              title: "Auth"
            }
            [api] "Public API" {
              fill: blue-100
            }
            [db] "Database"
            [api] -> [db] : queries {
              stroke: blue-700
            }
            """);

        Assert.DoesNotContain(diagram.Diagnostics, d => d.Severity == SketchDiagnosticSeverity.Error);
        Assert.Equal(new[] { "api", "db" }, diagram.Nodes.Select(n => n.Id).ToArray());
        Assert.Equal("Public API", diagram.Nodes[0].Label);
        Assert.Equal("queries", diagram.Edges.Single().Label);
    }

    [Fact]
    public void CompileToSvg_AppliesClassAndInlineStyles()
    {
        var result = new SketchCompiler().CompileToSvg("""
            class service {
              shape: rounded-rect
              fill: blue-100
              stroke: blue-700
            }

            [api] "Public API" {
              class: service
            }
            [db] "Database" {
              fill: green-100
              stroke: green-700
            }
            [api] -> [db] : queries {
              stroke: red-700
              stroke-width: 3
            }
            """);

        Assert.Contains("fill=\"#dbeafe\"", result.Svg);
        Assert.Contains("stroke=\"#1d4ed8\"", result.Svg);
        Assert.Contains("fill=\"#dcfce7\"", result.Svg);
        Assert.Contains("stroke=\"#15803d\"", result.Svg);
        Assert.Contains("stroke=\"#b91c1c\" stroke-width=\"3\"", result.Svg);
        Assert.Contains("fill=\"#b91c1c\"", result.Svg);
    }

    [Fact]
    public void CompileToSvg_SupportsHexNamedAndThemeColors()
    {
        var result = new SketchCompiler().CompileToSvg("""
            [api] "API" {
              fill: hex(#123abc)
              stroke: blue
            }
            [worker] "Worker" {
              fill: purple
              stroke: theme(swatch1)
            }
            [api] -> [worker] : calls {
              stroke: rgba(20,184,166,0.5)
            }
            """);

        Assert.DoesNotContain(result.Diagnostics, d => d.Severity == SketchDiagnosticSeverity.Error);
        Assert.Contains("fill=\"#123abc\"", result.Svg);
        Assert.Contains("stroke=\"#3b82f6\"", result.Svg);
        Assert.Contains("fill=\"#a855f7\"", result.Svg);
        Assert.Contains("stroke=\"theme(swatch1)\"", result.Svg);
        Assert.Contains("stroke=\"rgba(20,184,166,0.5)\"", result.Svg);
    }

    [Fact]
    public void CompileToSvg_TreatsRawHashAsCommentInPropertyBlocks()
    {
        var result = new SketchCompiler().CompileToSvg("""
            [api] "API" {
              fill: blue # this is a comment
              stroke: hex(#123abc)
            }
            """);

        Assert.DoesNotContain(result.Diagnostics, d => d.Severity == SketchDiagnosticSeverity.Error);
        Assert.Contains("fill=\"#3b82f6\"", result.Svg);
        Assert.Contains("stroke=\"#123abc\"", result.Svg);
    }

    [Fact]
    public void Resolve_ParsesMetaBlockDirectionAndTitle()
    {
        var diagram = new SketchCompiler().Resolve("""
            sketch {
              title: "My Diagram"
              direction: top-to-bottom
            }
            A -> B
            """);

        Assert.DoesNotContain(diagram.Diagnostics, d => d.Severity == SketchDiagnosticSeverity.Error);
        Assert.Equal("My Diagram", diagram.Meta.Title);
        Assert.Equal(SketchLayoutDirection.TopToBottom, diagram.Meta.Direction);
    }

    [Fact]
    public void Layout_TopToBottomUsesBottomCenterEndpoints()
    {
        var diagram = new SketchCompiler().Layout("""
            sketch {
              direction: top-to-bottom
            }
            [a] "Source"
            [b] "Target"
            [a] -> [b]
            """);

        Assert.Equal(SketchLayoutDirection.TopToBottom, diagram.Direction);
        var edge = diagram.Edges.Single();
        var source = diagram.Nodes.Single(n => n.Id == "a");
        var target = diagram.Nodes.Single(n => n.Id == "b");

        Assert.Equal(source.X + source.Width / 2, edge.X1, precision: 1);
        Assert.Equal(source.Y + source.Height, edge.Y1, precision: 1);
        Assert.Equal(target.X + target.Width / 2, edge.X2, precision: 1);
        Assert.Equal(target.Y, edge.Y2, precision: 1);
    }

    [Fact]
    public void CompileToSvg_UndirectedEdgeOmitsArrowhead()
    {
        var result = new SketchCompiler().CompileToSvg("A -- B");

        Assert.DoesNotContain(result.Diagnostics, d => d.Severity == SketchDiagnosticSeverity.Error);
        Assert.Contains("sketch-edge-direction=\"undirected\"", result.Svg);
        Assert.DoesNotContain("<polygon", result.Svg);
    }

    [Fact]
    public void CompileToSvg_BidirectionalEdgeHasTwoArrowheads()
    {
        var result = new SketchCompiler().CompileToSvg("A <-> B");

        Assert.DoesNotContain(result.Diagnostics, d => d.Severity == SketchDiagnosticSeverity.Error);
        Assert.Contains("sketch-edge-direction=\"bidirectional\"", result.Svg);

        var polygonCount = 0;
        var searchIn = result.Svg;
        var idx = 0;
        while ((idx = searchIn.IndexOf("<polygon", idx, StringComparison.Ordinal)) >= 0)
        {
            polygonCount++;
            idx++;
        }
        Assert.Equal(2, polygonCount);
    }

    [Fact]
    public void Resolve_MultipleClassesAreMergedInOrder()
    {
        var diagram = new SketchCompiler().Resolve("""
            class base {
              fill: blue-100
              stroke: blue-700
            }
            class highlight {
              stroke: red-700
            }
            [node] {
              class: [base, highlight]
            }
            """);

        Assert.DoesNotContain(diagram.Diagnostics, d => d.Severity == SketchDiagnosticSeverity.Error);
        var node = diagram.Nodes.Single();
        Assert.Equal("blue-100", node.Style.Fill?.Value);
        Assert.Equal("red-700", node.Style.Stroke?.Value);
    }

    [Fact]
    public void Resolve_ParsesInlineNodeProperties()
    {
        var diagram = new SketchCompiler().Resolve("""
            class important { stroke: red-700 }
            [c] "Output" { class: important fill: green }
            """);

        Assert.DoesNotContain(diagram.Diagnostics, d => d.Severity == SketchDiagnosticSeverity.Error);
        var node = diagram.Nodes.Single(n => n.Id == "c");
        Assert.Equal("green", node.Style.Fill?.Value);
        Assert.Equal("red-700", node.Style.Stroke?.Value);
    }

    [Fact]
    public void Resolve_ParsesInlineClassProperties()
    {
        var diagram = new SketchCompiler().Resolve("""
            class important { fill: green stroke: red-700 stroke-width: 3 }
            [c] "Output" { class: important }
            """);

        Assert.DoesNotContain(diagram.Diagnostics, d => d.Severity == SketchDiagnosticSeverity.Error);
        var node = diagram.Nodes.Single(n => n.Id == "c");
        Assert.Equal("green", node.Style.Fill?.Value);
        Assert.Equal("red-700", node.Style.Stroke?.Value);
        Assert.Equal(3, node.Style.StrokeWidth);
    }

    [Fact]
    public void Resolve_ParsesInlineGroupProperties()
    {
        var diagram = new SketchCompiler().Resolve("""
            group outputs "Outputs" { fill: green stroke: red-700 [c] }
            [c] "Output"
            """);

        Assert.DoesNotContain(diagram.Diagnostics, d => d.Severity == SketchDiagnosticSeverity.Error);
        var group = Assert.Single(diagram.Groups);
        Assert.Equal("green", group.Style.Fill?.Value);
        Assert.Equal("red-700", group.Style.Stroke?.Value);
        Assert.Equal(new[] { "c" }, group.NodeIds.ToArray());
    }

    [Fact]
    public void CompileToSvg_FormatsCoordinatesWithInvariantCulture()
    {
        var previousCulture = System.Threading.Thread.CurrentThread.CurrentCulture;
        try
        {
            // Use a culture that formats numbers with comma as the decimal separator.
            // Without invariant formatting, SVG number attributes (and especially the
            // polygon "points" attribute) would become invalid and the diagram would
            // render with overlapping nodes, broken arrowheads, and mis-placed labels.
            System.Threading.Thread.CurrentThread.CurrentCulture = new System.Globalization.CultureInfo("de-DE");

            var result = new SketchCompiler().CompileToSvg("""
                sketch { direction: top-to-bottom }
                [a] "Source"
                [b] "Target"
                [a] <-> [b]
                """);

            Assert.DoesNotContain(result.Diagnostics, d => d.Severity == SketchDiagnosticSeverity.Error);
            Assert.DoesNotContain("515,5", result.Svg);
            Assert.DoesNotMatch(new System.Text.RegularExpressions.Regex("""(x|y|width|height|rx|ry|stroke-width|x1|y1|x2|y2|font-size)="\d+,\d"""), result.Svg);
            Assert.DoesNotMatch(new System.Text.RegularExpressions.Regex("""points="\d+,\d+,\d+ """), result.Svg);
        }
        finally
        {
            System.Threading.Thread.CurrentThread.CurrentCulture = previousCulture;
        }
    }

    [Fact]
    public void CompileToSvg_OffsetsBranchingEdgeLabels()
    {
        var source = """
            sketch { direction: top-to-bottom }
            [client] "Student Client App With A Long Label That Should Wrap"
            [api] "Public API"
            [auth] "Auth Service"
            [cache] "Redis Cache"
            [teacher] "Teacher Portal"

            [client] -> [api] : "calls <escaped label>"
            [teacher] -> [api] : reviews progress
            [api] -> [auth] : validates session
            [api] -- [cache] : shares cached data
            """;

        var compiler = new SketchCompiler();
        var layout = compiler.Layout(source);
        var result = compiler.CompileToSvg(source);

        Assert.DoesNotContain(result.Diagnostics, d => d.Severity == SketchDiagnosticSeverity.Error);

        var labelBoxes = ExtractLabelBoxes(result.Svg);
        Assert.False(labelBoxes["calls <escaped label>"].Intersects(labelBoxes["reviews progress"]));
        Assert.False(labelBoxes["validates session"].Intersects(labelBoxes["shares cached data"]));

        foreach (var edge in layout.Edges.Where(e => !string.IsNullOrWhiteSpace(e.Label)))
        {
            var midpointX = (edge.X1 + edge.X2) / 2;
            Assert.Equal(midpointX, labelBoxes[edge.Label!].TextX, precision: 1);
        }
    }

    [Fact]
    public void CompileToSvg_AllNodesHaveRectInSvg()
    {
        const string source = """
            sketch {
              direction: top-to-bottom
            }
            class service { fill: blue-100 stroke: blue-700 }
            [client] "Client" { fill: pink-100 stroke: pink-700 }
            [api]    "Public API" { class: service }
            [auth]   "Auth Service" { class: service }
            [db]     "Database" { fill: green-100 stroke: green-700 }
            [teacher] "Teacher Portal" { fill: purple-100 stroke: purple-700 }
            [cache]  "Redis Cache" { fill: yellow-100 stroke: yellow-700 }
            [client] -> [api]
            [api] -> [auth]
            [auth] -> [db]
            [api] -- [cache]
            [teacher] -> [api]
            """;

        var compiler = new SketchCompiler();
        var layout = compiler.Layout(source);
        var result = compiler.CompileToSvg(source);

        Assert.DoesNotContain(result.Diagnostics, d => d.Severity == SketchDiagnosticSeverity.Error);

        // Every node must appear as a named group with a rect in the SVG.
        foreach (var node in layout.Nodes)
        {
            Assert.Contains($"node:{node.Id}", result.Svg);
        }

        // Count <rect elements: 1 SVG background + 1 per node + 1 per edge with a label.
        var edgesWithLabels = layout.Edges.Count(e => !string.IsNullOrWhiteSpace(e.Label));
        var rectCount = CountSubstring(result.Svg, "<rect");
        Assert.Equal(layout.Nodes.Count + 1 + edgesWithLabels, rectCount);

        // Auth and cache must be at distinct X positions (not overlapping).
        var authNode  = layout.Nodes.Single(n => n.Id == "auth");
        var cacheNode = layout.Nodes.Single(n => n.Id == "cache");
        Assert.NotEqual(authNode.X, cacheNode.X);

        // All nodes should be at non-negative positions.
        foreach (var node in layout.Nodes)
        {
            Assert.True(node.X >= 0, $"Node {node.Id} has negative X={node.X}");
            Assert.True(node.Y >= 0, $"Node {node.Id} has negative Y={node.Y}");
            Assert.True(node.Width > 0, $"Node {node.Id} has non-positive Width={node.Width}");
            Assert.True(node.Height > 0, $"Node {node.Id} has non-positive Height={node.Height}");
        }
    }

    [Fact]
    public void CompileToSvg_CircleShapeRendersCircleElement()
    {
        var result = new SketchCompiler().CompileToSvg("""
            [a] "Node A" { shape: circle }
            [b] "Node B"
            [a] -> [b]
            """);

        Assert.DoesNotContain(result.Diagnostics, d => d.Severity == SketchDiagnosticSeverity.Error);
        Assert.Contains("<circle", result.Svg);
    }

    [Fact]
    public void CompileToSvg_DiamondShapeRendersDiamondPolygon()
    {
        var result = new SketchCompiler().CompileToSvg("""
            [d] "Decision" { shape: diamond }
            [a] "Action"
            [d] -> [a]
            """);

        Assert.DoesNotContain(result.Diagnostics, d => d.Severity == SketchDiagnosticSeverity.Error);
        // Diamond renders as polygon (node polygons); arrowheads are also polygons, so just check
        // that the SVG contains a polygon that is NOT an arrowhead (arrowheads have 3 points, diamond has 4).
        var doc = System.Xml.Linq.XDocument.Parse(result.Svg);
        var polygons = doc.Root!.Descendants()
            .Where(e => e.Name.LocalName == "polygon")
            .ToList();
        Assert.Contains(polygons, p => (p.Attribute("points")?.Value ?? string.Empty).Split(' ').Length == 4);
    }

    [Fact]
    public void CompileToSvg_DashedEdgeHasStrokeDasharray()
    {
        var result = new SketchCompiler().CompileToSvg("""
            A -> B { style: dashed }
            """);

        Assert.DoesNotContain(result.Diagnostics, d => d.Severity == SketchDiagnosticSeverity.Error);
        Assert.Contains("stroke-dasharray", result.Svg);
    }

    [Fact]
    public void CompileToSvg_DottedEdgeHasStrokeDasharray()
    {
        var result = new SketchCompiler().CompileToSvg("""
            A -- B { style: dotted }
            """);

        Assert.DoesNotContain(result.Diagnostics, d => d.Severity == SketchDiagnosticSeverity.Error);
        Assert.Contains("stroke-dasharray", result.Svg);
    }

    [Fact]
    public void CompileToSvg_TooltipRendersAsTitleElement()
    {
        var result = new SketchCompiler().CompileToSvg("""
            [api] "API" { tooltip: "Handles all requests" }
            [db] "Database"
            [api] -> [db]
            """);

        Assert.DoesNotContain(result.Diagnostics, d => d.Severity == SketchDiagnosticSeverity.Error);
        Assert.Contains("<title>Handles all requests</title>", result.Svg);
    }

    [Fact]
    public void Resolve_GroupDeclarationCreatesResolvedGroup()
    {
        var diagram = new SketchCompiler().Resolve("""
            group backend "Backend Services" {
              fill: blue-50
              [api]
              [db]
            }
            [api] -> [db]
            """);

        Assert.DoesNotContain(diagram.Diagnostics, d => d.Severity == SketchDiagnosticSeverity.Error);
        var group = Assert.Single(diagram.Groups);
        Assert.Equal("backend", group.Id);
        Assert.Equal("Backend Services", group.Label);
        Assert.Equal(new[] { "api", "db" }, group.NodeIds.ToArray());
        Assert.Equal("blue-50", group.Style.Fill?.Value);
    }

    [Fact]
    public void Layout_GroupBoundsContainMemberNodes()
    {
        var layout = new SketchCompiler().Layout("""
            group sys "System" {
              [a]
              [b]
            }
            [a] -> [b]
            """);

        var group = Assert.Single(layout.Groups);
        var nodeA = layout.Nodes.Single(n => n.Id == "a");
        var nodeB = layout.Nodes.Single(n => n.Id == "b");

        // Group bounding box must contain both nodes
        Assert.True(group.X <= nodeA.X, $"Group left ({group.X}) should be <= node A left ({nodeA.X})");
        Assert.True(group.Y <= nodeA.Y, $"Group top ({group.Y}) should be <= node A top ({nodeA.Y})");
        Assert.True(group.X + group.Width >= nodeB.X + nodeB.Width, "Group right should contain node B");
        Assert.True(group.Y + group.Height >= nodeB.Y + nodeB.Height, "Group bottom should contain node B");
    }

    [Fact]
    public void CompileToSvg_GroupRendersBackgroundRect()
    {
        var result = new SketchCompiler().CompileToSvg("""
            group infra "Infrastructure" {
              [db]
              [cache]
            }
            [api] -> [db]
            [api] -> [cache]
            """);

        Assert.DoesNotContain(result.Diagnostics, d => d.Severity == SketchDiagnosticSeverity.Error);
        Assert.Contains("group:infra", result.Svg);
        Assert.Contains("Infrastructure", result.Svg);
    }

    [Fact]
    public void Layout_RightToLeftMirrorsNodePositions()
    {
        var ltr = new SketchCompiler().Layout("[a] \"A\"\n[b] \"B\"\n[a] -> [b]");
        var rtl = new SketchCompiler().Layout("sketch { direction: right-to-left }\n[a] \"A\"\n[b] \"B\"\n[a] -> [b]");

        var ltrA = ltr.Nodes.Single(n => n.Id == "a");
        var ltrB = ltr.Nodes.Single(n => n.Id == "b");
        var rtlA = rtl.Nodes.Single(n => n.Id == "a");
        var rtlB = rtl.Nodes.Single(n => n.Id == "b");

        // In LTR: A is to the left of B. In RTL: A should be to the right of B.
        Assert.True(ltrA.X < ltrB.X, "LTR: A before B");
        Assert.True(rtlA.X > rtlB.X, "RTL: A after B (mirrored)");
    }

    [Fact]
    public void Layout_BottomToTopMirrorsNodePositions()
    {
        var ttb = new SketchCompiler().Layout("sketch { direction: top-to-bottom }\n[a] \"A\"\n[b] \"B\"\n[a] -> [b]");
        var btt = new SketchCompiler().Layout("sketch { direction: bottom-to-top }\n[a] \"A\"\n[b] \"B\"\n[a] -> [b]");

        var ttbA = ttb.Nodes.Single(n => n.Id == "a");
        var ttbB = ttb.Nodes.Single(n => n.Id == "b");
        var bttA = btt.Nodes.Single(n => n.Id == "a");
        var bttB = btt.Nodes.Single(n => n.Id == "b");

        // In TTB: A is above B. In BTT: A should be below B.
        Assert.True(ttbA.Y < ttbB.Y, "TTB: A above B");
        Assert.True(bttA.Y > bttB.Y, "BTT: A below B (mirrored)");
    }

    private static int CountSubstring(string source, string value)
    {
        var count = 0;
        var idx = 0;
        while ((idx = source.IndexOf(value, idx, System.StringComparison.Ordinal)) >= 0)
        {
            count++;
            idx++;
        }
        return count;
    }

    private static IReadOnlyDictionary<string, LabelBox> ExtractLabelBoxes(string svg)
    {
        var elements = System.Xml.Linq.XDocument.Parse(svg).Root!.Descendants().ToArray();
        var boxes = new Dictionary<string, LabelBox>(StringComparer.Ordinal);
        for (var i = 0; i < elements.Length - 1; i++)
        {
            if (elements[i].Name.LocalName != "rect" || elements[i + 1].Name.LocalName != "text")
                continue;

            boxes[elements[i + 1].Value] = new LabelBox(
                ReadDouble(elements[i], "x"),
                ReadDouble(elements[i], "y"),
                ReadDouble(elements[i], "width"),
                ReadDouble(elements[i], "height"),
                ReadDouble(elements[i + 1], "x"),
                ReadDouble(elements[i + 1], "y"));
        }

        return boxes;
    }

    private static double ReadDouble(System.Xml.Linq.XElement element, string attributeName) =>
        double.Parse(element.Attribute(attributeName)?.Value ?? "0", System.Globalization.CultureInfo.InvariantCulture);

    private readonly record struct LabelBox(double X, double Y, double Width, double Height, double TextX, double TextY)
    {
        public bool Intersects(LabelBox other) =>
            X < other.X + other.Width
            && X + Width > other.X
            && Y < other.Y + other.Height
            && Y + Height > other.Y;
    }
}
