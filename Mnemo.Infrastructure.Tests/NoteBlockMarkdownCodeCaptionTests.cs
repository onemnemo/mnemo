using Mnemo.Core.Models;
using Mnemo.Infrastructure.Services.Notes.Markdown;

namespace Mnemo.Infrastructure.Tests;

/// <summary>A code block's caption through the markdown writer and reader.</summary>
public class NoteBlockMarkdownCodeCaptionTests
{
    private static Block Code(string language, string source, string caption = "") => new()
    {
        Type = BlockType.Code,
        Order = 0,
        Spans = new List<InlineSpan> { InlineSpan.Plain(source) },
        Payload = new CodePayload(language, source, Caption: caption),
    };

    private static string Written(params Block[] blocks) =>
        NoteBlockMarkdownConverter.Serialize(blocks).Replace("\r\n", "\n", StringComparison.Ordinal);

    [Fact]
    public void Serialize_WritesTheCaptionInTheFenceLine() =>
        Assert.Equal("```ts caption=\"Figure one\"\nlet x = 1;\n```", Written(Code("ts", "let x = 1;", "Figure one")));

    [Fact]
    public void Serialize_WritesABlockWithoutACaptionExactlyAsBefore()
    {
        Assert.Equal("```ts\nlet x = 1;\n```", Written(Code("ts", "let x = 1;")));
        Assert.Equal("```\nplain\n```", Written(Code("", "plain")));
    }

    [Fact]
    public void Deserialize_ReadsTheCaptionWithTheLanguageAndTheSource()
    {
        var back = NoteBlockMarkdownConverter.Deserialize("```ts caption=\"Figure one\"\nlet x = 1;\n```");
        var code = Assert.IsType<CodePayload>(Assert.Single(back).Payload);
        Assert.Equal(("ts", "let x = 1;", "Figure one"), (code.Language, code.Source, code.Caption));
    }

    [Theory]
    [InlineData("say \"hi\"")]
    [InlineData("C:\\temp\\x")]
    [InlineData("use `ticks`")]
    [InlineData("\\u0060")]
    [InlineData("ends with a backslash \\")]
    [InlineData("a caption: with, punctuation")]
    public void RoundTrip_KeepsTheCaption(string caption)
    {
        var back = NoteBlockMarkdownConverter.Deserialize(Written(Code("js", "body", caption)));
        var code = Assert.IsType<CodePayload>(Assert.Single(back).Payload);
        Assert.Equal(("js", "body", caption), (code.Language, code.Source, code.Caption));
    }

    [Fact]
    public void RoundTrip_KeepsACaptionBesideASourceHoldingAFence()
    {
        const string source = "a\n```\nb";
        var back = NoteBlockMarkdownConverter.Deserialize(Written(Code("md", source, "nested")));
        var code = Assert.IsType<CodePayload>(Assert.Single(back).Payload);
        Assert.Equal(("md", source, "nested"), (code.Language, code.Source.Replace("\r\n", "\n", StringComparison.Ordinal), code.Caption));
    }
}
