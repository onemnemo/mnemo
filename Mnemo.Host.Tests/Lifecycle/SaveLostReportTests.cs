using Mnemo.Host.Lifecycle;

using SaveLostOutcome = Mnemo.Host.Lifecycle.LifecycleEndpoints.SaveLostOutcome;
using SaveLostRequest = Mnemo.Host.Lifecycle.LifecycleEndpoints.SaveLostRequest;

namespace Mnemo.Host.Tests.Lifecycle;

/// <summary>
/// Checks accepted report fields and rejection of values that could inject log records.
/// </summary>
public sealed class SaveLostReportTests
{
    [Fact]
    public void AWellFormedReportBecomesOneLineNamingTheTriggerTheNoteAndTheVerdict()
    {
        var outcome = Resolve(new SaveLostRequest("6f1c9a2b", "failed", "shutdown"), out var line);

        Assert.Equal(SaveLostOutcome.Recorded, outcome);
        Assert.Contains("trigger=shutdown", line, StringComparison.Ordinal);
        Assert.Contains("note=6f1c9a2b", line, StringComparison.Ordinal);
        Assert.Contains("verdict=failed", line, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("lost")]
    [InlineData("Failed")]
    [InlineData("")]
    [InlineData(null)]
    public void AVerdictThisHostDoesNotRecordIsRefused(string? verdict)
    {
        Assert.Equal(
            SaveLostOutcome.UnknownVerdict,
            Resolve(new SaveLostRequest("6f1c9a2b", verdict, "close"), out var line));
        Assert.Equal(string.Empty, line);
    }

    [Theory]
    [InlineData("reload")]
    [InlineData("Close")]
    [InlineData(null)]
    public void AnExitThisHostDoesNotRecordIsRefused(string? trigger)
    {
        Assert.Equal(
            SaveLostOutcome.UnknownTrigger,
            Resolve(new SaveLostRequest("6f1c9a2b", "conflict", trigger), out var line));
        Assert.Equal(string.Empty, line);
    }

    [Fact]
    public void ANoteIdCarryingANewlineCannotForgeASecondLine()
    {
        // Reject arbitrary client text rather than escaping it into the host log.
        Assert.Equal(
            SaveLostOutcome.UnusableNote,
            Resolve(new SaveLostRequest("abc\n[00:00:00] [Warning] [Mnemo.Host] fake", "failed", "close"), out var line));
        Assert.Equal(string.Empty, line);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("6f1c 9a2b")]
    [InlineData("../../etc")]
    [InlineData("6f1c\r9a2b")]
    public void ANoteIdThatIsNotAnIdentifierIsRefused(string? noteId)
    {
        Assert.Equal(
            SaveLostOutcome.UnusableNote,
            Resolve(new SaveLostRequest(noteId, "failed", "close"), out var line));
        Assert.Equal(string.Empty, line);
    }

    [Fact]
    public void AnOverLongNoteIdIsRefused()
    {
        Assert.Equal(
            SaveLostOutcome.UnusableNote,
            Resolve(new SaveLostRequest(new string('a', 65), "failed", "close"), out _));
    }

    [Fact]
    public void TheIdentifiersThisAppMintsGetThrough()
    {
        // Note ids are GUID strings, so the allowlist has to cover hex and hyphens and
        // the cap has to sit above 36.
        Assert.Equal(
            SaveLostOutcome.Recorded,
            Resolve(new SaveLostRequest(Guid.NewGuid().ToString(), "conflict", "close"), out _));
    }

    [Fact]
    public void AMissingBodyIsRefusedRatherThanLogged()
    {
        Assert.Equal(SaveLostOutcome.UnknownVerdict, Resolve(null, out var line));
        Assert.Equal(string.Empty, line);
    }

    private static SaveLostOutcome Resolve(SaveLostRequest? body, out string line)
        => LifecycleEndpoints.ResolveSaveLost(body, out line);
}
