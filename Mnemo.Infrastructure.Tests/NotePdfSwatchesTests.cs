using System.Text.RegularExpressions;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.Notes.Pdf;

namespace Mnemo.Infrastructure.Tests;

/// <summary>
/// The PDF palette is read from the web app's token file at run time, so these pin the reading and
/// the conversion rather than any particular colour: changing a swatch in tokens.css is supposed to
/// change the PDF with no test to update.
/// </summary>
public sealed class NotePdfSwatchesTests
{
    [Fact]
    public void Embedded_tokens_give_ten_hex_swatches_per_role()
    {
        foreach (var palette in new[] { NotePdfSwatches.Background, NotePdfSwatches.Foreground })
        {
            Assert.Equal(10, palette.Count);
            for (var i = 1; i <= 10; i++)
                Assert.Matches("^#[0-9A-F]{6}$", palette[$"swatch{i}"]);
        }
    }

    [Theory]
    [InlineData("oklch(1 0 0)", "#FFFFFF")]
    [InlineData("oklch(0 0 0)", "#000000")]
    [InlineData("oklch(0.6279554 0.2576833 29.2338851)", "#FF0000")]
    [InlineData("oklch(0.4520137 0.3132147 264.052)", "#0000FF")]
    public void Oklch_converts_to_srgb_hex(string oklch, string hex) =>
        Assert.Equal(hex, NotePdfSwatches.OklchToHex(oklch));

    [Fact]
    public void Reads_the_light_block_and_resolves_the_neutral_hue()
    {
        var swatches = string.Join(string.Empty, Enumerable.Range(1, 10).Select(i =>
            $"--color-swatch-{i}: oklch(1 0 0); --text-color-swatch-{i}: oklch(0 0 var(--neutral-hue));"));
        var css = $$"""
            :root { --neutral-hue: 260; }
            /* a comment with { braces } */
            [data-theme="light"] { {{swatches}} }
            [data-theme="dark"] { --color-swatch-1: oklch(0 0 0); }
            """;

        var (background, foreground) = NotePdfSwatches.Parse(css);

        Assert.Equal("#FFFFFF", background["swatch1"]);
        Assert.Equal("#000000", foreground["swatch10"]);
    }

    [Fact]
    public void Plain_highlight_and_link_take_the_palette()
    {
        var note = new Note
        {
            Title = "T",
            Blocks =
            [
                new Block
                {
                    Type = BlockType.Text,
                    Spans =
                    [
                        new TextSpan("marked", new TextStyle(Highlight: true)),
                        new TextSpan("source", new TextStyle(LinkUrl: "https://example.com")),
                    ],
                },
            ],
        };
        var options = new NotePdfExportOptions
        {
            RenderColors = true,
            BackgroundSwatchHexByName = NotePdfSwatches.Background,
            ForegroundSwatchHexByName = NotePdfSwatches.Foreground,
        };

        var typ = NoteTypstDocumentComposer.Compose(note, options, null);

        Assert.Contains($"#highlight(fill: rgb(\"{NotePdfSwatches.Background["swatch7"]}\"))[marked]", typ);
        Assert.Contains($"#text(fill: rgb(\"{NotePdfSwatches.Foreground["swatch3"]}\"))[#underline[source]]", typ);
        Assert.DoesNotMatch(new Regex(@"#highlight\["), typ);
    }
}
