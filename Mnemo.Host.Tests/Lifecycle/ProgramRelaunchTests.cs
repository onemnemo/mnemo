namespace Mnemo.Host.Tests.Lifecycle;

public sealed class ProgramRelaunchTests
{
    [Fact]
    public void RelaunchArguments_ReplacesAnExistingPredecessorAndPreservesOtherArguments()
    {
        var arguments = Program.RelaunchArguments(
            ["--dev", Program.WaitForProcessArgument, "41", "--port", "5180"],
            73);

        Assert.Equal(["--dev", "--port", "5180", Program.WaitForProcessArgument, "73"], arguments);
    }

    [Theory]
    [InlineData(41, "--dev", "--wait-for-process", "41")]
    [InlineData(null, "--wait-for-process", "invalid")]
    [InlineData(null, "--dev")]
    public void PredecessorProcessId_ReadsOnlyAValidPositiveProcessId(int? expected, params string[] arguments)
    {
        Assert.Equal(expected, Program.PredecessorProcessId(arguments));
    }
}
