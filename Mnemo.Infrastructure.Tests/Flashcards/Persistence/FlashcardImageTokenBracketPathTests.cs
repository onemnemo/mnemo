using System;
using System.Collections.Generic;
using System.IO;
using Mnemo.Infrastructure.Services.Flashcards.Persistence;
using Xunit;

namespace Mnemo.Infrastructure.Tests.Flashcards.Persistence;

/// <summary>
/// A token whose path holds a bracket, which a duplicated Windows account name such as
/// <c>alice (2)</c> produces, has to be read to its own closing bracket rather than to the
/// first one in the path. Closing early left the tail of the path loose in the card text and
/// never let the file resolve.
/// </summary>
public sealed class FlashcardImageTokenBracketPathTests : IDisposable
{
    private readonly string _tempDir = Path.Combine(Path.GetTempPath(), $"mnemo_imgtok_{Guid.NewGuid():N}", "alice (2)");

    public FlashcardImageTokenBracketPathTests() => Directory.CreateDirectory(_tempDir);

    public void Dispose()
    {
        try { Directory.Delete(Path.GetDirectoryName(_tempDir)!, recursive: true); }
        catch { /* best effort */ }
    }

    [Fact]
    public void Convert_PathWithBracketedDirectory_ResolvesTheWholePath()
    {
        var imagePath = Path.Combine(_tempDir, "9f2.png");
        File.WriteAllBytes(imagePath, new byte[12]);
        var front = $"Name the part.\n![a diagram]({imagePath}){{align=center}}";

        var result = FlashcardImageTokenConverter.Convert("card-b1", front, string.Empty);

        Assert.Equal("Name the part.", result.CleanFront);
        Assert.Empty(result.Warnings);
        var attachment = Assert.Single(result.Attachments);
        Assert.Equal(Path.GetFullPath(imagePath), attachment.FilePath);
        Assert.Equal("a diagram", attachment.Caption);
    }

    [Fact]
    public void Convert_MissingFileInBracketedDirectory_KeepsTheWholeTokenAndNamesTheWholePath()
    {
        var missingPath = Path.Combine(_tempDir, "gone.png");
        var front = $"Question ![alt]({missingPath})";

        var result = FlashcardImageTokenConverter.Convert("card-b2", front, string.Empty);

        Assert.Equal(front, result.CleanFront);
        Assert.Empty(result.Attachments);
        var warning = Assert.Single(result.Warnings);
        Assert.Equal(missingPath, warning.Path);
    }

    [Fact]
    public void StripTokensForFiles_PathWithBracketedDirectory_LeavesNoTailBehind()
    {
        var text = $"Front text\n![alt]({Path.Combine(_tempDir, "9f2.png")})\nMore";

        var stripped = FlashcardImageTokenConverter.StripTokensForFiles(text, new HashSet<string>(StringComparer.Ordinal) { "9f2.png" });

        Assert.DoesNotContain("9f2.png", stripped);
        Assert.DoesNotContain(")", stripped);
        Assert.Equal("Front text\n\nMore", stripped);
    }

    [Fact]
    public void Convert_BracketedTextAfterTheToken_IsNotReadAsPartOfThePath()
    {
        var imagePath = Path.Combine(_tempDir, "cell.png");
        File.WriteAllBytes(imagePath, new byte[8]);
        var front = $"![cell]({imagePath}) (see the figure)";

        var result = FlashcardImageTokenConverter.Convert("card-b3", front, string.Empty);

        Assert.Equal("(see the figure)", result.CleanFront.Trim());
        var attachment = Assert.Single(result.Attachments);
        Assert.Equal(Path.GetFullPath(imagePath), attachment.FilePath);
    }
}
