using Mnemo.Host.Notes;
using Xunit;

namespace Mnemo.Host.Tests.Notes;

/// <summary>
/// The PDF export's download name, one of the host's five title-to-filename builders. It shares
/// Mnemo.Host.Lifecycle.ReservedFileNames with the other four, so a note titled "CON" falls back to
/// the generic name the same way an empty title already did, rather than reaching a save dialog
/// pre-filled with a name Windows refuses to create.
/// </summary>
public sealed class NotePdfDownloadNameTests
{
    [Theory]
    [InlineData("CON")]
    [InlineData("con")]
    [InlineData("nul.backup")]
    public void FallsBackOnAReservedDeviceName(string title) =>
        Assert.Equal("note.pdf", NotePdfEndpoints.DownloadName(title));

    [Fact]
    public void KeepsAnOrdinaryTitle() =>
        Assert.Equal("Kanji stage 3.pdf", NotePdfEndpoints.DownloadName("Kanji stage 3"));

    [Fact]
    public void FallsBackOnAMissingTitle() =>
        Assert.Equal("note.pdf", NotePdfEndpoints.DownloadName(null));
}
