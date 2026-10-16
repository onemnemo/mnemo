using System.Text.Json;
using Mnemo.Core.Models;
using Mnemo.Infrastructure.Services.Notes.Markdown;

namespace Mnemo.Infrastructure.Tests;

/// <summary>An inline line break tag reads like a markdown hard break.</summary>
public class NoteBlockMarkdownLineBreakTagTests
{
    // The web parser reads the same vectors.
    public static IEnumerable<object[]> Vectors()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "Notes", "inline-line-breaks.json");
        foreach (var item in JsonDocument.Parse(File.ReadAllText(path)).RootElement.EnumerateArray())
        {
            yield return new object[]
            {
                item.GetProperty("name").GetString()!,
                item.GetProperty("markdown").GetString()!,
                item.GetProperty("rows").EnumerateArray().Select(r => r.GetString()!).ToArray(),
                item.TryGetProperty("written", out var written) ? written.GetString()! : ""
            };
        }
    }

    private static string Row(InlineSpan span)
    {
        var text = ((TextSpan)span).Text;
        var style = ((TextSpan)span).Style;
        var flags = new List<string>();
        if (style.Bold) flags.Add("b");
        if (style.Italic) flags.Add("i");
        if (style.Strikethrough) flags.Add("s");
        if (style.Code) flags.Add("code");
        if (style.LinkUrl is not null) flags.Add($"link={style.LinkUrl}");
        return flags.Count > 0 ? $"{text}|{string.Join(",", flags)}" : text;
    }

    [Theory]
    [MemberData(nameof(Vectors))]
    public void ToSpans_ReadsALineBreakTag(string name, string markdown, string[] rows, string written)
    {
        Assert.NotEmpty(name);
        var spans = InlineMarkdownParser.ToSpans(markdown);
        Assert.Equal(rows, spans.Select(Row));
        if (written.Length == 0)
            return;

        Assert.Equal(written, InlineMarkdownSerializer.SerializeSpans(spans));
        var again = InlineMarkdownParser.ToSpans(written);
        Assert.Equal(string.Concat(spans.OfType<TextSpan>().Select(t => t.Text)), string.Concat(again.OfType<TextSpan>().Select(t => t.Text)));
        Assert.Equal(written, InlineMarkdownSerializer.SerializeSpans(again));
    }

    [Fact]
    public void Deserialize_BreaksTheLineInsideAParagraphHeadingAndListItem()
    {
        var back = NoteBlockMarkdownConverter.Deserialize("one<br>two\n\n# a<br>b\n\n- x<br>y");

        Assert.Equal(new[] { "one\ntwo", "a\nb", "x\ny" }, back.Select(b => b.Content));
    }

    [Fact]
    public void Deserialize_KeepsBothWordsApartInATableCell()
    {
        var table = Assert.Single(NoteBlockMarkdownConverter.Deserialize("| a<br>b | c |\n| --- | --- |\n| d | e<br/>f |"));

        Assert.Equal(
            new[] { new[] { "a\nb", "c" }, new[] { "d", "e\nf" } },
            table.Children!.Select(r => r.Children!.Select(c => c.Content).ToArray()).ToArray());
    }

    [Fact]
    public void RoundTrip_ATagBreak_IsStableAfterTheFirstExport()
    {
        var first = NoteBlockMarkdownConverter.Deserialize("one<br>two\n\n| a<br>b | c |\n| --- | --- |");
        var md = NoteBlockMarkdownConverter.Serialize(first).Replace("\r\n", "\n", StringComparison.Ordinal);

        Assert.Contains("one\\\ntwo", md);
        Assert.Contains("| a<br>b | c |", md);

        var second = NoteBlockMarkdownConverter.Deserialize(md);
        var again = NoteBlockMarkdownConverter.Serialize(second).Replace("\r\n", "\n", StringComparison.Ordinal);
        Assert.Equal(md, again);
        Assert.Equal("one\ntwo", second[0].Content);
        Assert.Equal("a\nb", second[1].Children![0].Children![0].Content);
    }

    [Fact]
    public void RoundTrip_ABreakNextToAPipeAndABackslashInACell_IsLossless()
    {
        var md = "| p\\|<br>q | x\\\\<br>y |\n| --- | --- |";
        var table = Assert.Single(NoteBlockMarkdownConverter.Deserialize(md));

        Assert.Equal(new[] { "p|\nq", "x\\\ny" }, table.Children![0].Children!.Select(c => c.Content));
        Assert.Equal(md, NoteBlockMarkdownConverter.Serialize(new[] { table }).Replace("\r\n", "\n", StringComparison.Ordinal).TrimEnd('\n'));
    }

    [Fact]
    public void RoundTrip_ATypedTagInACell_StaysText()
    {
        var md = "| \\<br> | c |\n| --- | --- |";
        var table = Assert.Single(NoteBlockMarkdownConverter.Deserialize(md));

        Assert.Equal("<br>", table.Children![0].Children![0].Content);
        Assert.Equal(md, NoteBlockMarkdownConverter.Serialize(new[] { table }).Replace("\r\n", "\n", StringComparison.Ordinal).TrimEnd('\n'));
    }

    [Fact]
    public void RoundTrip_ABreakAtTheEndOfAHeading_StaysInTheHeading()
    {
        var first = NoteBlockMarkdownConverter.Deserialize("# T<br>");
        var md = NoteBlockMarkdownConverter.Serialize(first).Replace("\r\n", "\n", StringComparison.Ordinal);
        var second = NoteBlockMarkdownConverter.Deserialize(md);

        Assert.Equal(BlockType.Heading1, Assert.Single(second).Type);
        Assert.Equal("T\n", second[0].Content);
        Assert.Equal(md, NoteBlockMarkdownConverter.Serialize(second).Replace("\r\n", "\n", StringComparison.Ordinal));
    }
}
