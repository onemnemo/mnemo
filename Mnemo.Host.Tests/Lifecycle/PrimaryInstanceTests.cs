using System.IO.Pipes;
using Mnemo.Core.Services;
using Mnemo.Host.Lifecycle;
using Xunit;
using LogLevel = Mnemo.Core.Enums.LogLevel;

namespace Mnemo.Host.Tests.Lifecycle;

public sealed class PrimaryInstanceTests : IDisposable
{
    private static readonly TimeSpan Wait = TimeSpan.FromSeconds(5);

    private readonly string _root =
        Path.Combine(Path.GetTempPath(), "mnemo-host-tests", Guid.NewGuid().ToString("N"));

    private readonly string _otherRoot =
        Path.Combine(Path.GetTempPath(), "mnemo-host-tests", Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        foreach (var root in new[] { _root, _otherRoot })
        {
            if (Directory.Exists(root))
                Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public void ASecondClaimOnTheSameProfileIsRefused()
    {
        using var first = PrimaryInstance.TryClaim(_root, PrimaryInstance.AppRole);

        Assert.NotNull(first);
        Assert.Null(PrimaryInstance.TryClaim(_root, PrimaryInstance.AppRole));
    }

    [Fact]
    public void DisposingTheClaimReleasesTheProfile()
    {
        var first = PrimaryInstance.TryClaim(_root, PrimaryInstance.AppRole);
        Assert.NotNull(first);
        first.Dispose();

        using var next = PrimaryInstance.TryClaim(_root, PrimaryInstance.AppRole);
        Assert.NotNull(next);
    }

    [Fact]
    public void SeparateProfilesAndRolesDoNotCollide()
    {
        using var app = PrimaryInstance.TryClaim(_root, PrimaryInstance.AppRole);
        using var dev = PrimaryInstance.TryClaim(_root, PrimaryInstance.DevRole);
        using var other = PrimaryInstance.TryClaim(_otherRoot, PrimaryInstance.AppRole);

        Assert.NotNull(app);
        Assert.NotNull(dev);
        Assert.NotNull(other);
    }

    [Fact]
    public async Task AnActivateMessageReachesTheListeningPrimary()
    {
        using var primary = PrimaryInstance.TryClaim(_root, PrimaryInstance.AppRole)!;
        var activated = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        primary.Listen(() => activated.TrySetResult() || true, new RecordingLogger());

        var answered = await PrimaryInstance.TryActivateAsync(_root, PrimaryInstance.AppRole, Wait);

        Assert.True(answered);
        await activated.Task.WaitAsync(Wait);
    }

    [Fact]
    public async Task ThePrimaryKeepsAnsweringLaterLaunches()
    {
        using var primary = PrimaryInstance.TryClaim(_root, PrimaryInstance.AppRole)!;
        var count = 0;
        primary.Listen(() => Interlocked.Increment(ref count) > 0, new RecordingLogger());

        Assert.True(await PrimaryInstance.TryActivateAsync(_root, PrimaryInstance.AppRole, Wait));
        Assert.True(await PrimaryInstance.TryActivateAsync(_root, PrimaryInstance.AppRole, Wait));
        Assert.Equal(2, Volatile.Read(ref count));
    }

    [Fact]
    public async Task AnActivateMessageDoesNotCrossProfiles()
    {
        using var primary = PrimaryInstance.TryClaim(_root, PrimaryInstance.AppRole)!;
        var activated = false;
        primary.Listen(() => activated = true, new RecordingLogger());

        var answered = await PrimaryInstance.TryActivateAsync(_otherRoot, PrimaryInstance.AppRole, TimeSpan.FromSeconds(1));

        Assert.False(answered);
        Assert.False(activated);
    }

    [Fact]
    public async Task APrimaryThatDeclinesIsNotAnAnswer()
    {
        // What a primary whose window is already closing says: the launch must wait for it to go.
        using var primary = PrimaryInstance.TryClaim(_root, PrimaryInstance.AppRole)!;
        primary.Listen(() => false, new RecordingLogger());

        Assert.False(await PrimaryInstance.TryActivateAsync(_root, PrimaryInstance.AppRole, Wait));
    }

    [Fact]
    public async Task AStoppedPrimaryNoLongerAnswers()
    {
        using var primary = PrimaryInstance.TryClaim(_root, PrimaryInstance.AppRole)!;
        primary.Listen(() => true, new RecordingLogger());
        Assert.True(await PrimaryInstance.TryActivateAsync(_root, PrimaryInstance.AppRole, Wait));

        await primary.StopListeningAsync();

        Assert.False(await PrimaryInstance.TryActivateAsync(_root, PrimaryInstance.AppRole, TimeSpan.FromSeconds(1)));
    }

    [Fact]
    public async Task ALaunchOnAFreeProfileClaimsIt()
    {
        var claim = await PrimaryInstance.ClaimOrActivateAsync(_root, PrimaryInstance.AppRole, Wait, new RecordingLogger());
        using var primary = claim.Primary;

        Assert.NotNull(primary);
        Assert.False(claim.Activated);
    }

    [Fact]
    public async Task ALaunchOnAHeldProfileActivatesTheHolderInstead()
    {
        using var primary = PrimaryInstance.TryClaim(_root, PrimaryInstance.AppRole)!;
        var activated = false;
        primary.Listen(() => activated = true, new RecordingLogger());

        var claim = await PrimaryInstance.ClaimOrActivateAsync(_root, PrimaryInstance.AppRole, Wait, new RecordingLogger());

        Assert.Null(claim.Primary);
        Assert.True(claim.Activated);
        Assert.True(activated);
    }

    [Fact]
    public async Task ALaunchWaitsForAnExitingHolderAndThenClaims()
    {
        // The old process still holds the profile but has stopped answering.
        var exiting = PrimaryInstance.TryClaim(_root, PrimaryInstance.AppRole)!;
        _ = Task.Delay(TimeSpan.FromMilliseconds(1500)).ContinueWith(_ => exiting.Dispose(), TaskScheduler.Default);

        var claim = await PrimaryInstance.ClaimOrActivateAsync(_root, PrimaryInstance.AppRole, TimeSpan.FromSeconds(15), new RecordingLogger());
        using var primary = claim.Primary;

        Assert.NotNull(primary);
        Assert.False(claim.Activated);
    }

    [Fact]
    public async Task ALaunchGivesUpOnAHolderThatNeverAnswers()
    {
        using var silent = PrimaryInstance.TryClaim(_root, PrimaryInstance.AppRole)!;

        var logger = new RecordingLogger();

        var claim = await PrimaryInstance.ClaimOrActivateAsync(_root, PrimaryInstance.AppRole, TimeSpan.FromSeconds(2), logger);

        Assert.Null(claim.Primary);
        Assert.False(claim.Activated);
        Assert.Single(logger.Warnings);
    }

    [Fact]
    public async Task AListenerThatCannotServeWarnsOnceAndBacksOff()
    {
        // Windows only: on Unix the listener clears a stale path, so there is nothing to provoke.
        if (!OperatingSystem.IsWindows())
            return;

        using var primary = PrimaryInstance.TryClaim(_root, PrimaryInstance.AppRole)!;
        await using var squatter = new NamedPipeServerStream(
            PrimaryInstance.EndpointName(_root, PrimaryInstance.AppRole), PipeDirection.InOut, 1);
        var logger = new RecordingLogger();

        primary.Listen(() => true, logger);
        await Task.Delay(TimeSpan.FromSeconds(2));
        await primary.StopListeningAsync();

        Assert.Single(logger.Warnings);
    }

    [Fact]
    public void BackoffDoublesFromTheRetryDelayAndCaps()
    {
        var first = PrimaryInstance.NextBackoff(TimeSpan.Zero);
        Assert.Equal(TimeSpan.FromMilliseconds(250), first);
        Assert.Equal(TimeSpan.FromMilliseconds(500), PrimaryInstance.NextBackoff(first));
        Assert.Equal(TimeSpan.FromSeconds(5), PrimaryInstance.NextBackoff(TimeSpan.FromSeconds(4)));
    }

    [Fact]
    public void TheSocketGoesInTheRuntimeDirectoryWhenTheSessionHasOne()
    {
        Directory.CreateDirectory(_root);
        var temp = Path.GetTempPath();

        Assert.Equal(_root, PrimaryInstance.SocketDirectory(_root, temp));
        Assert.Equal(temp, PrimaryInstance.SocketDirectory(null, temp));
        Assert.Equal(temp, PrimaryInstance.SocketDirectory("  ", temp));
        Assert.Equal(temp, PrimaryInstance.SocketDirectory("relative/run", temp));
        Assert.Equal(temp, PrimaryInstance.SocketDirectory(Path.Combine(_root, "missing"), temp));
    }

    private sealed class RecordingLogger : ILoggerService
    {
        private readonly System.Collections.Concurrent.ConcurrentQueue<string> _warnings = new();

        public IReadOnlyList<string> Warnings => [.. _warnings];

        public void Log(LogLevel level, string category, string message, Exception? exception = null)
        {
            if (level >= LogLevel.Warning)
                _warnings.Enqueue($"{category}: {message}");
        }
    }
}
