using System;
using System.Collections.Generic;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Mindmap;
using Mnemo.Infrastructure.Services.Mindmap;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Mindmap;

public sealed class MindmapDocumentSerializerTests
{
    [Fact]
    public void RoundTrip_PreservesAllContentKinds()
    {
        var document = new MindmapDocument
        {
            Id = "m1",
            Title = "Kinds",
            Revision = 3,
            CreatedAt = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc),
            ModifiedAt = new DateTime(2026, 1, 2, 0, 0, 0, DateTimeKind.Utc),
            Elements = new List<MindmapElement>
            {
                Node("n1", new TextContent { Text = "root" }),
                Node("n2", new ImageContent { AssetId = "a1", Caption = "cap" }),
                Node("n3", new LinkContent { Url = "https://x.test", Title = "X" }),
                Node("n4", new FlashcardContent { DeckId = "d1", CardId = "c1" }),
                Node("n5", new NoteContent { NoteId = "no1" }),
                Node("n6", new TaskContent { Text = "todo", Done = true, Due = new DateTime(2026, 3, 1, 0, 0, 0, DateTimeKind.Utc) }),
                Node("n7", new CodeContent { Language = "csharp", Source = "x();" }),
                Node("n8", new TextContent
                {
                    Text = "bold e=mc^2",
                    Runs = new InlineSpan[]
                    {
                        new TextSpan("bold ", new TextStyle(Bold: true)),
                        new EquationSpan("e=mc^2"),
                    },
                }),
                Free("s1", ElementKind.Shape, new ShapeContent { Shape = ShapeType.Diamond, Text = "if" }),
                Free("t1", ElementKind.Text, new FreeTextContent { Text = "label" }),
                Free("i1", ElementKind.Image, new CanvasImageContent { AssetId = "a2" }),
                Free("f1", ElementKind.Frame, new FrameContent { Title = "Group", ChildIds = new[] { "n1" } }),
            },
            Edges = new List<MindmapEdge>
            {
                new() { Id = "e1", FromId = "n1", ToId = "n2", Kind = EdgeKind.Hierarchy },
                new() { Id = "e2", FromId = "s1", ToId = "n1", Kind = EdgeKind.Link, Style = new EdgeStyle { Line = LineStyle.Dashed, EndCap = ArrowCap.Arrow } },
            },
            Clusters = new List<ClusterSettings>
            {
                new() { RootId = "n1", LayoutAlgorithm = MindmapLayoutAlgorithms.TreeRight },
            },
        };

        var json = MindmapDocumentSerializer.Serialize(document);
        var reserialized = MindmapDocumentSerializer.Serialize(MindmapDocumentSerializer.Deserialize(json)!);

        // A stable re-serialization proves every field (and each polymorphic content payload) round-trips.
        Assert.Equal(json, reserialized);
    }

    [Fact]
    public void Runs_AreOmittedWhenAbsent_SoUnformattedRowsKeepTheirBytes()
    {
        var document = new MindmapDocument
        {
            Id = "m1",
            Title = "T",
            Elements = new List<MindmapElement>
            {
                Node("n1", new TextContent { Text = "plain" }),
                Node("n2", new TaskContent { Text = "todo" }),
                Free("s1", ElementKind.Shape, new ShapeContent { Text = "if" }),
                Free("t1", ElementKind.Text, new FreeTextContent { Text = "label" }),
            },
        };

        var json = MindmapDocumentSerializer.Serialize(document);

        Assert.DoesNotContain("runs", json);
        Assert.Contains("{\"$type\":\"text\",\"text\":\"plain\"}", json);
    }

    [Fact]
    public void Runs_RoundTrip_EveryMarkAndAtom()
    {
        var runs = new InlineSpan[]
        {
            new TextSpan("a", new TextStyle(Bold: true, Italic: true, Underline: true, Strikethrough: true, Code: true, Highlight: true)),
            new TextSpan("b", new TextStyle(BackgroundColor: "swatch2", ForegroundColor: "swatch3", LinkUrl: "https://x.test", Subscript: true)),
            new TextSpan("c\nd", new TextStyle(Superscript: true, SuppressAutoLink: true)),
            new EquationSpan("x^2", new TextStyle(Bold: true)),
            new FractionSpan(1, 2),
        };
        var document = new MindmapDocument
        {
            Id = "m1",
            Title = "T",
            Elements = new List<MindmapElement> { Node("n1", new TextContent { Text = "abc\ndx^21/2", Runs = runs }) },
        };

        var json = MindmapDocumentSerializer.Serialize(document);
        var read = MindmapDocumentSerializer.Deserialize(json)!;

        var content = Assert.IsType<TextContent>(read.Elements[0].Content);
        Assert.Equal(runs, content.Runs);
        Assert.Equal(json, MindmapDocumentSerializer.Serialize(read));
    }

    [Fact]
    public void StoredMathRow_ReadsAsTextWithOneEquationRun()
    {
        const string json = """
            {"schemaVersion":2,"id":"m1","title":"Old","elements":[
              {"id":"e1","kind":"node","content":{"$type":"math","latex":"\\frac{a}{b}"}}]}
            """;

        var document = MindmapDocumentSerializer.Deserialize(json)!;

        var content = Assert.IsType<TextContent>(document.Elements[0].Content);
        Assert.Equal("\\frac{a}{b}", content.Text);
        var run = Assert.Single(content.Runs!);
        Assert.Equal(new EquationSpan("\\frac{a}{b}"), run);

        var reserialized = MindmapDocumentSerializer.Serialize(document);
        Assert.Contains("\"$type\":\"text\"", reserialized);
        Assert.DoesNotContain("\"$type\":\"math\"", reserialized);
    }

    [Fact]
    public void ADamagedRun_ReadsAsAnEmptyOne_RatherThanFailingTheDocument()
    {
        const string json = """
            {"schemaVersion":2,"id":"m1","title":"T","elements":[
              {"id":"e1","kind":"node","content":{"$type":"text","text":"a","runs":[null,7,{"kind":"text","text":"a"}]}}]}
            """;

        var document = MindmapDocumentSerializer.Deserialize(json)!;

        var content = Assert.IsType<TextContent>(document.Elements[0].Content);
        Assert.Equal(new InlineSpan[] { new TextSpan(""), new TextSpan(""), new TextSpan("a") }, content.Runs);
    }

    [Fact]
    public void UnknownDiscriminator_RoundTripsAsPlaceholder_WithoutDataLoss()
    {
        const string json = """
            {"schemaVersion":2,"id":"m1","title":"Future","elements":[
              {"id":"e1","kind":"node","content":{"$type":"webEmbed","url":"https://x.test","zoom":3}}]}
            """;

        var document = MindmapDocumentSerializer.Deserialize(json)!;

        var placeholder = Assert.IsType<PlaceholderContent>(document.Elements[0].Content);
        Assert.Equal("webEmbed", placeholder.OriginalType);

        var reserialized = MindmapDocumentSerializer.Serialize(document);
        Assert.Contains("\"$type\":\"webEmbed\"", reserialized);
        Assert.Contains("\"url\":\"https://x.test\"", reserialized);
        Assert.Contains("\"zoom\":3", reserialized);
    }

    [Fact]
    public void Serialize_OmitsDefaults_And_WritesEnumsAsStrings()
    {
        var document = new MindmapDocument
        {
            Id = "m1",
            Title = "T",
            Elements = new List<MindmapElement> { Node("n1", new TextContent { Text = "hi" }) },
            Edges = new List<MindmapEdge>
            {
                new() { Id = "e1", FromId = "n1", ToId = "n1", Kind = EdgeKind.Link, Style = new EdgeStyle { Line = LineStyle.Dashed } },
            },
        };

        var json = MindmapDocumentSerializer.Serialize(document);

        Assert.Contains("\"schemaVersion\":2", json);
        Assert.DoesNotContain("\"pinned\"", json);   // default false omitted
        Assert.DoesNotContain("\"collapsed\"", json); // default false omitted
        Assert.DoesNotContain("\"x\":0", json);        // default 0 omitted
        Assert.Contains("\"dashed\"", json);           // enum as camelCase string
    }

    private static MindmapElement Node(string id, IElementContent content) =>
        new() { Id = id, Kind = ElementKind.Node, Content = content };

    private static MindmapElement Free(string id, ElementKind kind, IElementContent content) =>
        new() { Id = id, Kind = kind, Content = content };
}
