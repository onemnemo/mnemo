using Mnemo.Host.Lifecycle;

namespace Mnemo.Host.Tests.Lifecycle;

/// <summary>
/// The reserved-device-name check every export route's download-name builder falls back through,
/// so a title of "CON" cannot reach a save dialog pre-filled with a name Windows refuses to create.
/// </summary>
public sealed class ReservedFileNamesTests
{
    [Theory]
    [InlineData("CON")]
    [InlineData("con")]
    [InlineData("PRN")]
    [InlineData("AUX")]
    [InlineData("NUL")]
    [InlineData("COM3")]
    [InlineData("com3")]
    [InlineData("LPT9")]
    [InlineData("nul.backup")]
    [InlineData("CONIN$")]
    [InlineData("conout$")]
    // The builders strip a trailing dot after trimming, so "CON ." reaches here as "CON " and
    // Windows would still strip the space and open the console device.
    [InlineData("CON ")]
    [InlineData(" nul .txt")]
    public void MatchesAReservedName(string name) => Assert.True(ReservedFileNames.IsReserved(name));

    [Theory]
    [InlineData("Console notes")]
    [InlineData("notes")]
    [InlineData("Comfort")]
    [InlineData("")]
    public void LeavesAnOrdinaryNameAlone(string name) => Assert.False(ReservedFileNames.IsReserved(name));
}
