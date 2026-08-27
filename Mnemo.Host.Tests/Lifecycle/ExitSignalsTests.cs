using System.Runtime.InteropServices;
using Mnemo.Core.Services;
using Mnemo.Host.Lifecycle;
using Xunit;
using LogLevel = Mnemo.Core.Enums.LogLevel;

namespace Mnemo.Host.Tests.Lifecycle;

/// <summary>
/// Checks signal routing without delivering a process signal to the test runner.
/// </summary>
public sealed class ExitSignalsTests
{
    private static readonly TimeSpan Bound = TimeSpan.FromSeconds(3);

    [Fact]
    public async Task ADeliveredSignalIsAbsorbedAndTheCloseIsAskedFor()
    {
        var context = new PosixSignalContext(PosixSignal.SIGTERM);
        var logger = new RecordingLogger();
        var asked = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

        ExitSignals.RequestClose(context, () => asked.SetResult(), logger);

        // Read before anything is awaited, because the runtime reads it as delivery returns: a
        // close asked for on another thread is no use if the default action has already run.
        Assert.True(context.Cancel);

        Assert.Same(asked.Task, await Task.WhenAny(asked.Task, Task.Delay(Bound)));
        Assert.Empty(logger.Errors);
    }

    [Fact]
    public async Task ACloseThatCannotBeDeliveredIsLoggedAndTheSignalStaysAbsorbed()
    {
        var context = new PosixSignalContext(PosixSignal.SIGTERM);
        var logger = new RecordingLogger();

        ExitSignals.RequestClose(context, () => throw new InvalidOperationException("no window"), logger);

        Assert.True(await LoggedAnErrorAsync(logger, Bound), "a close that threw went unreported");
        Assert.True(context.Cancel);
    }

    private static async Task<bool> LoggedAnErrorAsync(RecordingLogger logger, TimeSpan bound)
    {
        var deadline = DateTime.UtcNow + bound;
        while (DateTime.UtcNow < deadline)
        {
            if (logger.Errors.Count > 0)
                return true;

            await Task.Delay(20);
        }

        return false;
    }

    private sealed class RecordingLogger : ILoggerService
    {
        private readonly System.Collections.Concurrent.ConcurrentQueue<string> _errors = new();

        public IReadOnlyList<string> Errors => [.. _errors];

        public void Log(LogLevel level, string category, string message, Exception? exception = null)
        {
            if (level >= LogLevel.Error)
                _errors.Enqueue($"{category}: {message} {exception}");
        }
    }
}
