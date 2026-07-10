using System.Collections.Generic;
using Mnemo.Core.Models.Mindmap;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Mindmap;

public sealed class MindmapMarkdownExporterTests
{
    [Fact]
    public void EmptyDocument_RendersTitleOnly()
    {
        var doc = new MindmapDocument { Id = "d", Title = "My Map" };

        Assert.Equal("# My Map", MindmapMarkdownExporter.ExportOutline(doc));
    }

    [Fact]
    public void NestedTree_RendersIndentedBulletsInEdgeOrder()
    {
        var doc = new MindmapDocument
        {
            Id = "d",
            Title = "T",
            Elements = new[]
            {
                Node("r", "R"),
                Node("a", "A"),
                Node("b", "B"),
                Node("a1", "A1"),
            },
            Edges = new[]
            {
                Hierarchy("e1", "r", "a"),
                Hierarchy("e2", "r", "b"),
                Hierarchy("e3", "a", "a1"),
            },
        };

        var md = MindmapMarkdownExporter.ExportOutline(doc);

        Assert.Equal("# T\n\n- R\n  - A\n    - A1\n  - B", md);
    }

    [Fact]
    public void ChildOrder_FollowsHierarchyEdgeOrder()
    {
        // Edges add B before A, so B must render first regardless of element order.
        var doc = new MindmapDocument
        {
            Id = "d",
            Title = "T",
            Elements = new[] { Node("r", "R"), Node("a", "A"), Node("b", "B") },
            Edges = new[] { Hierarchy("e1", "r", "b"), Hierarchy("e2", "r", "a") },
        };

        var md = MindmapMarkdownExporter.ExportOutline(doc);

        Assert.Equal("# T\n\n- R\n  - B\n  - A", md);
    }

    [Fact]
    public void ContentMappings_RenderEachNodeKind()
    {
        var doc = new MindmapDocument
        {
            Id = "d",
            Title = "T",
            Elements = new[]
            {
                Node("r", "Root"),
                new MindmapElement { Id = "t1", Kind = ElementKind.Node, Content = new TaskContent { Text = "done", Done = true } },
                new MindmapElement { Id = "t2", Kind = ElementKind.Node, Content = new TaskContent { Text = "todo", Done = false } },
                new MindmapElement { Id = "m", Kind = ElementKind.Node, Content = new MathContent { Latex = "E=mc^2" } },
                new MindmapElement { Id = "l1", Kind = ElementKind.Node, Content = new LinkContent { Url = "https://x", Title = "Docs" } },
                new MindmapElement { Id = "l2", Kind = ElementKind.Node, Content = new LinkContent { Url = "https://y" } },
                new MindmapElement { Id = "n", Kind = ElementKind.Node, Content = new NoteContent { NoteId = "note-1" } },
                new MindmapElement { Id = "f", Kind = ElementKind.Node, Content = new FlashcardContent { DeckId = "deck-1" } },
                new MindmapElement { Id = "img", Kind = ElementKind.Node, Content = new ImageContent { AssetId = "a.png", Caption = "cap" } },
                new MindmapElement { Id = "c", Kind = ElementKind.Node, Content = new CodeContent { Language = "py", Source = "print(1)" } },
            },
            Edges = new[]
            {
                Hierarchy("e1", "r", "t1"),
                Hierarchy("e2", "r", "t2"),
                Hierarchy("e3", "r", "m"),
                Hierarchy("e4", "r", "l1"),
                Hierarchy("e5", "r", "l2"),
                Hierarchy("e6", "r", "n"),
                Hierarchy("e7", "r", "f"),
                Hierarchy("e8", "r", "img"),
                Hierarchy("e9", "r", "c"),
            },
        };

        var md = MindmapMarkdownExporter.ExportOutline(doc);

        Assert.Contains("  - [x] done", md);
        Assert.Contains("  - [ ] todo", md);
        Assert.Contains("  - $E=mc^2$", md);
        Assert.Contains("  - [Docs](https://x)", md);
        Assert.Contains("  - [https://y](https://y)", md);
        Assert.Contains("  - note-1 (note)", md);
        Assert.Contains("  - deck-1 (deck)", md);
        Assert.Contains("  - ![cap](a.png)", md);
        Assert.Contains("  - `print(1)`", md);
    }

    [Fact]
    public void MultilineCode_RendersFencedBlockWithLanguage()
    {
        var doc = new MindmapDocument
        {
            Id = "d",
            Title = "T",
            Elements = new[]
            {
                new MindmapElement { Id = "c", Kind = ElementKind.Node, Content = new CodeContent { Language = "python", Source = "a\nb" } },
            },
        };

        var md = MindmapMarkdownExporter.ExportOutline(doc);

        Assert.Equal("# T\n\n- `a`\n  ```python\n  a\n  b\n  ```", md);
    }

    [Fact]
    public void SingleLineCode_HasNoFence()
    {
        var doc = new MindmapDocument
        {
            Id = "d",
            Title = "T",
            Elements = new[]
            {
                new MindmapElement { Id = "c", Kind = ElementKind.Node, Content = new CodeContent { Language = "py", Source = "x = 1" } },
            },
        };

        var md = MindmapMarkdownExporter.ExportOutline(doc);

        Assert.Equal("# T\n\n- `x = 1`", md);
        Assert.DoesNotContain("```", md);
    }

    [Fact]
    public void LinkEdges_RenderAsFootnotesWithAndWithoutLabel()
    {
        var doc = new MindmapDocument
        {
            Id = "d",
            Title = "T",
            Elements = new[] { Node("r", "R"), Node("a", "A"), Node("b", "B"), Node("c", "C") },
            Edges = new[]
            {
                Hierarchy("h1", "r", "a"),
                Hierarchy("h2", "r", "b"),
                Hierarchy("h3", "r", "c"),
                Link("l1", "a", "b", "rel"),
                Link("l2", "b", "c", null),
            },
        };

        var md = MindmapMarkdownExporter.ExportOutline(doc);

        Assert.Contains("- A[^1]", md);
        Assert.Contains("- B[^2]", md);
        Assert.Contains("[^1]: → B (rel)", md);
        Assert.Contains("[^2]: → C", md);
        Assert.DoesNotContain("[^2]: → C (", md); // no label parenthesis
    }

    [Fact]
    public void FreeElementsAndFrames_RenderInTrailingSections()
    {
        var doc = new MindmapDocument
        {
            Id = "d",
            Title = "T",
            Elements = new[]
            {
                new MindmapElement { Id = "s", Kind = ElementKind.Shape, Content = new ShapeContent { Shape = ShapeType.Rectangle, Text = "box" } },
                new MindmapElement { Id = "ft", Kind = ElementKind.Text, Content = new FreeTextContent { Text = "note" } },
                new MindmapElement { Id = "ci", Kind = ElementKind.Image, Content = new CanvasImageContent { AssetId = "img.png" } },
                new MindmapElement { Id = "empty", Kind = ElementKind.Shape, Content = new ShapeContent { Shape = ShapeType.Ellipse } },
                new MindmapElement { Id = "fr", Kind = ElementKind.Frame, Content = new FrameContent { Title = "Group", ChildIds = new[] { "s", "ft" } } },
            },
        };

        var md = MindmapMarkdownExporter.ExportOutline(doc);

        Assert.Contains("## Canvas elements", md);
        Assert.Contains("- box", md);
        Assert.Contains("- note", md);
        Assert.Contains("- ![](img.png)", md);
        Assert.Contains("### Group", md);
        // The empty-text shape is skipped (no bullet with an empty label).
        Assert.DoesNotContain("- \n", md);
        Assert.DoesNotContain("-  ", md);
    }

    [Fact]
    public void Export_IsDeterministic()
    {
        var doc = new MindmapDocument
        {
            Id = "d",
            Title = "T",
            Elements = new[] { Node("r", "R"), Node("a", "A"), Node("b", "B") },
            Edges = new[] { Hierarchy("e1", "r", "a"), Hierarchy("e2", "r", "b") },
        };

        Assert.Equal(MindmapMarkdownExporter.ExportOutline(doc), MindmapMarkdownExporter.ExportOutline(doc));
    }

    private static MindmapElement Node(string id, string text) => new()
    {
        Id = id,
        Kind = ElementKind.Node,
        Content = new TextContent { Text = text },
    };

    private static MindmapEdge Hierarchy(string id, string from, string to) => new()
    {
        Id = id,
        FromId = from,
        ToId = to,
        Kind = EdgeKind.Hierarchy,
    };

    private static MindmapEdge Link(string id, string from, string to, string? label) => new()
    {
        Id = id,
        FromId = from,
        ToId = to,
        Kind = EdgeKind.Link,
        Label = label,
    };
}
