using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.Notes.Markdown;
using Mnemo.Infrastructure.Services.Notes.Pdf;

namespace Mnemo.Infrastructure.Tests;

public sealed class NotePdfSketchExportTests
{
    [Fact]
    public void Deserialize_SketchFenceCreatesSketchBlock()
    {
        var blocks = NoteBlockMarkdownConverter.Deserialize("""
            ```sketch
            A -> B
            ```
            """);

        var block = Assert.Single(blocks);
        Assert.Equal(BlockType.Sketch, block.Type);
        Assert.Equal("A -> B", block.Content);
    }

    [Fact]
    public void Compose_SketchBlockEmbedsSvgInsteadOfSourceText()
    {
        var note = new Note
        {
            Title = "Sketch export",
            Blocks =
            [
                new Block { Type = BlockType.Sketch, Order = 0, Spans = [InlineSpan.Plain("A -> B")] }
            ]
        };

        var typ = NoteTypstDocumentComposer.Compose(note, new NotePdfExportOptions());

        // The compiled sketch is embedded as an inline SVG image, not printed as its DSL source.
        Assert.Contains("format: \"svg\"", typ);
        Assert.DoesNotContain("A -> B", typ);
    }

    [Fact]
    public void NormalizeSketchSvgForPdf_ResolvesThemeSwatches()
    {
        var svg = """
            <svg xmlns="http://www.w3.org/2000/svg">
            <rect width="100%" height="100%" fill="transparent" />
            <rect fill="theme(swatch1)" stroke="theme(swatch9)" />
            </svg>
            """;
        var options = new NotePdfExportOptions
        {
            BackgroundSwatchHexByName = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
            {
                ["swatch1"] = "#F5F5F5",
                ["swatch9"] = "#DBEAFE"
            }
        };

        var normalized = NoteTypstDocumentComposer.NormalizeSketchSvgForPdf(svg, options);

        Assert.Contains("fill=\"#ffffff\"", normalized);
        Assert.Contains("fill=\"#F5F5F5\"", normalized);
        Assert.Contains("stroke=\"#DBEAFE\"", normalized);
        Assert.DoesNotContain("theme(", normalized);
    }

    [Fact]
    public void ResolveSketchPdfLayout_UsesPayloadWidthAndAlignment()
    {
        var block = new Block
        {
            Type = BlockType.Sketch,
            Payload = new SketchPayload(320, "right")
        };

        var (widthPt, align) = NoteTypstDocumentComposer.ResolveSketchPdfLayout(block);

        Assert.Equal(240, widthPt);
        Assert.Equal("right", align);
    }
}
