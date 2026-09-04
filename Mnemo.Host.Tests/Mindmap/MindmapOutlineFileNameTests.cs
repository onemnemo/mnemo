using Mnemo.Host.Mindmap;
using Xunit;

namespace Mnemo.Host.Tests.Mindmap;

/// <summary>
/// The outline export's download name, one of the host's five title-to-filename builders. It shares
/// Mnemo.Host.Lifecycle.ReservedFileNames with the other four, so a map titled "NUL" falls back to
/// the generic name rather than reaching a save dialog pre-filled with a name Windows refuses to
/// create.
/// </summary>
public sealed class MindmapOutlineFileNameTests
{
    [Theory]
    [InlineData("NUL")]
    [InlineData("nul")]
    [InlineData("com3.old")]
    public void FallsBackOnAReservedDeviceName(string title) =>
        Assert.Equal("mindmap.md", MindmapEndpoints.OutlineFileName(title));

    [Fact]
    public void KeepsAnOrdinaryTitle() =>
        Assert.Equal("Kanji stage 3.md", MindmapEndpoints.OutlineFileName("Kanji stage 3"));

    [Fact]
    public void FallsBackOnAMissingTitle() =>
        Assert.Equal("mindmap.md", MindmapEndpoints.OutlineFileName(null));

    [Fact]
    public void FallsBackOnATitleThatSanitizesToNothingButWhitespace()
    {
        // Sanitizing ". ." strips the leading and trailing dots and leaves a single space, which the
        // old name.Length == 0 check let through as " .md" instead of falling back.
        Assert.Equal("mindmap.md", MindmapEndpoints.OutlineFileName(". ."));
    }
}
