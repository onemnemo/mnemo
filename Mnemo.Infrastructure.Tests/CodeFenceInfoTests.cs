using Mnemo.Infrastructure.Services.Notes.Markdown;

namespace Mnemo.Infrastructure.Tests;

/// <summary>Shares its table with <c>code-fence-info.test.ts</c>.</summary>
public class CodeFenceInfoTests
{
    public static TheoryData<string, string, string> Vectors => new()
    {
        { "ts", "", "ts" },
        { "", "", "" },
        { "ts", "Figure one", "ts caption=\"Figure one\"" },
        { "", "No language", "caption=\"No language\"" },
        { "python", "say \"hi\"", "python caption=\"say \\\"hi\\\"\"" },
        { "sh", "C:\\temp\\x", "sh caption=\"C:\\\\temp\\\\x\"" },
        { "js", "use `x`", "js caption=\"use \\u0060x\\u0060\"" },
        { "js", "\\u0060", "js caption=\"\\\\u0060\"" },
        { "cs", "ends with a backslash \\", "cs caption=\"ends with a backslash \\\\\"" },
    };

    [Theory]
    [MemberData(nameof(Vectors))]
    public void Format_WritesTheCaptionAfterTheLanguage(string language, string caption, string info) =>
        Assert.Equal(info, CodeFenceInfo.Format(language, caption));

    [Theory]
    [MemberData(nameof(Vectors))]
    public void Parse_ReadsBackWhatFormatWrote(string language, string caption, string info) =>
        Assert.Equal((language, caption), CodeFenceInfo.Parse(info));

    [Fact]
    public void Format_WritesALineBreakAsASpaceAndDropsABlankCaption()
    {
        Assert.Equal("ts caption=\"one two\"", CodeFenceInfo.Format("ts", "one\r\ntwo"));
        Assert.Equal("ts", CodeFenceInfo.Format("ts", "  \n "));
    }

    [Theory]
    [InlineData("ts linenos")]
    [InlineData("ts caption=plain")]
    [InlineData("ts caption=\"open")]
    [InlineData("ts caption=\"a\" more")]
    [InlineData("xcaption=\"a\"")]
    public void Parse_LeavesAnInfoStringWithoutAClosingCaptionAsItWas(string info) =>
        Assert.Equal((info, string.Empty), CodeFenceInfo.Parse(info));

    [Fact]
    public void Parse_KeepsExtraWordsBeforeTheCaptionWithTheLanguage() =>
        Assert.Equal(("ts linenos", "x"), CodeFenceInfo.Parse("ts linenos caption=\"x\""));
}
