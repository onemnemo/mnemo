using System;
using System.IO;
using System.Linq;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards.Persistence;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Flashcards.Persistence;

/// <summary>
/// Covers <see cref="FlashcardImageTokenConverter"/>: the boundary that turns legacy embedded image
/// tokens (<c>![alt](path){align=...}</c>) into <see cref="FlashcardAttachment"/> records so no
/// downstream renderer needs to regex-parse card text again.
/// </summary>
public sealed class FlashcardImageTokenConverterTests : IDisposable
{
    private readonly string _tempDir = Path.Combine(Path.GetTempPath(), $"mnemo_imgtok_{Guid.NewGuid():N}");

    public FlashcardImageTokenConverterTests() => Directory.CreateDirectory(_tempDir);

    public void Dispose()
    {
        try { Directory.Delete(_tempDir, recursive: true); }
        catch { /* best effort */ }
    }

    private string CreateImage(string name, int bytes = 42)
    {
        var path = Path.Combine(_tempDir, name);
        File.WriteAllBytes(path, new byte[bytes]);
        return path;
    }

    [Fact]
    public void Convert_ExistingFile_CreatesAttachment_AndStripsToken()
    {
        var imagePath = CreateImage("diagram.png", 1234);
        var front = $"What is this?\n![a diagram](" + imagePath + "){align=center}";

        var result = FlashcardImageTokenConverter.Convert("card-1", front, "Back text");

        Assert.DoesNotContain("![", result.CleanFront);
        Assert.Equal("What is this?", result.CleanFront);
        Assert.Empty(result.Warnings);

        var attachment = Assert.Single(result.Attachments);
        Assert.Equal(FlashcardAttachment.FrontSide, attachment.Side);
        Assert.Equal("diagram.png", attachment.DisplayName);
        Assert.Equal(1234, attachment.SizeBytes);
        Assert.Equal("a diagram", attachment.Caption);
        Assert.Equal(Path.GetFullPath(imagePath), attachment.FilePath);
    }

    [Fact]
    public void Convert_MissingFile_LeavesTokenInline_AndWarns()
    {
        var missingPath = Path.Combine(_tempDir, "does-not-exist.png");
        var front = $"Question ![alt]({missingPath})";

        var result = FlashcardImageTokenConverter.Convert("card-2", front, string.Empty);

        Assert.Contains("![alt](" + missingPath + ")", result.CleanFront);
        Assert.Empty(result.Attachments);
        var warning = Assert.Single(result.Warnings);
        Assert.Equal("card-2", warning.CardId);
        Assert.Equal(FlashcardAttachment.FrontSide, warning.Side);
        Assert.Contains(missingPath, warning.Message);
    }

    [Fact]
    public void Convert_MoreThanThreePerSide_ConvertsFirstThree_LeavesRestInline()
    {
        var paths = Enumerable.Range(1, 4).Select(i => CreateImage($"img{i}.png")).ToArray();
        var back = string.Join("\n", paths.Select(p => $"![img]({p})"));

        var result = FlashcardImageTokenConverter.Convert("card-3", string.Empty, back);

        Assert.Equal(3, result.Attachments.Count);
        Assert.All(result.Attachments, a => Assert.Equal(FlashcardAttachment.BackSide, a.Side));
        // The 4th token stays inline.
        Assert.Contains(paths[3], result.CleanBack);
        var warning = Assert.Single(result.Warnings);
        Assert.Equal(FlashcardAttachment.BackSide, warning.Side);
        Assert.Equal(paths[3], warning.Path);
    }

    [Fact]
    public void Convert_StrippingToken_CollapsesBlankLinesLeftBehind()
    {
        var imagePath = CreateImage("solo.png");
        var front = $"Line one\n\n![alt]({imagePath})\n\nLine two";

        var result = FlashcardImageTokenConverter.Convert("card-4", front, string.Empty);

        Assert.Equal("Line one\n\nLine two", result.CleanFront);
    }

    [Fact]
    public void Convert_NoTokens_ReturnsTextUnchanged_AndNoAttachments()
    {
        var result = FlashcardImageTokenConverter.Convert("card-5", "Plain front", "Plain back");

        Assert.Equal("Plain front", result.CleanFront);
        Assert.Equal("Plain back", result.CleanBack);
        Assert.Empty(result.Attachments);
        Assert.Empty(result.Warnings);
    }

    [Fact]
    public void Convert_TokenWithoutAlt_LeavesCaptionNull()
    {
        var imagePath = CreateImage("noalt.png");
        var back = $"![]({imagePath})";

        var result = FlashcardImageTokenConverter.Convert("card-6", string.Empty, back);

        var attachment = Assert.Single(result.Attachments);
        Assert.Null(attachment.Caption);
    }
}
