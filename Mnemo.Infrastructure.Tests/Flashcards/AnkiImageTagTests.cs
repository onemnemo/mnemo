using Mnemo.Infrastructure.Services.ImportExport.Adapters;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Flashcards;

/// <summary>Which file an Anki field's image tag names, however its source is quoted.</summary>
public sealed class AnkiImageTagTests
{
    [Theory]
    [InlineData("<img src=\"heart.png\">", "heart.png")]
    [InlineData("<img src='heart.png' />", "heart.png")]
    [InlineData("<img src=heart.png>", "heart.png")]
    [InlineData("<img src=heart.png/>", "heart.png")]
    [InlineData("<img src=heart.png />", "heart.png")]
    [InlineData("<img src=dir/heart.png>", "dir/heart.png")]
    [InlineData("<img alt=x src=heart.png width=200>", "heart.png")]
    public void ImageTag_ReadsTheSource(string html, string expected)
    {
        var match = FlashcardsAnkiFormatAdapter.ImageTagRegex.Match(html);

        Assert.True(match.Success);
        Assert.Equal(expected, match.Groups["src"].Value);
    }

    [Fact]
    public void ImageTag_StaysQuickOnAFieldOfUnclosedTags()
    {
        var hostile = string.Concat(System.Linq.Enumerable.Repeat("<img src=x ", 50_000));
        var clock = System.Diagnostics.Stopwatch.StartNew();

        var count = FlashcardsAnkiFormatAdapter.ImageTagRegex.Matches(hostile).Count;

        Assert.Equal(0, count);
        Assert.True(clock.Elapsed < System.TimeSpan.FromSeconds(2), $"took {clock.Elapsed}");
    }
}
