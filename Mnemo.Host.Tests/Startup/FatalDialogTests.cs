using Mnemo.Host.Startup;

namespace Mnemo.Host.Tests.Startup;

/// <summary>
/// Showing the dialog itself needs a real desktop, or on Windows a real user32, so
/// nothing here drives <c>FatalDialog.Show</c>. What is worth pinning down is the
/// text it builds: whether a person is told where the log went, and how the message
/// reads when there was nowhere to say that resolved.
/// </summary>
public sealed class FatalDialogTests
{
    private static readonly InvalidOperationException SampleError = new("The socket was already closed.");

    [Fact]
    public void OpensWithTheTitleAsASentence()
    {
        var text = FatalDialog.ComposeMessage(SampleError, "Mnemo could not start", logsDirectory: null);

        Assert.StartsWith($"Mnemo could not start.{Environment.NewLine}{Environment.NewLine}", text);
    }

    [Fact]
    public void NamesTheExceptionTypeAndItsMessage()
    {
        var text = FatalDialog.ComposeMessage(SampleError, "Mnemo could not start", logsDirectory: null);

        Assert.Contains("InvalidOperationException: The socket was already closed.", text);
    }

    [Fact]
    public void PointsAtTheLogDirectory_WhenOneWasResolved()
    {
        var text = FatalDialog.ComposeMessage(SampleError, "Mnemo has stopped", @"C:\Users\alex\AppData\Local\Mnemo\logs");

        Assert.Contains("The full details were written to:", text);
        Assert.Contains(@"C:\Users\alex\AppData\Local\Mnemo\logs", text);
    }

    [Fact]
    public void SaysNothingAboutLogs_WhenTheDirectoryCouldNotBeResolved()
    {
        // Resolving the data root can itself be what is broken, and the message has to
        // stand on its own rather than claim a location that may not even exist.
        var text = FatalDialog.ComposeMessage(SampleError, "Mnemo has stopped", logsDirectory: null);

        Assert.DoesNotContain("written to", text);
    }

    [Fact]
    public void TheStartupAndCrashTitlesReadAsDifferentSentences()
    {
        // Worth pinning down because the two send a person to different places: one
        // never opened, and the other was working a moment ago.
        var startup = FatalDialog.ComposeMessage(SampleError, "Mnemo could not start", logsDirectory: null);
        var crash = FatalDialog.ComposeMessage(SampleError, "Mnemo has stopped", logsDirectory: null);

        Assert.NotEqual(startup, crash);
    }
}
