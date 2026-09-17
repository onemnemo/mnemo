using System.Collections.Concurrent;
using Mnemo.Core.Enums;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Tests;

/// <summary>
/// The logger handed to services under test. It keeps every entry, and writes anything at error
/// level to the test host's error stream as well: a service that catches an exception into a
/// failed result logs it here and nowhere else, so a logger that discarded it left the failure to
/// surface as an unrelated assertion somewhere downstream. A test that expects a clean run can
/// assert <see cref="Errors"/> is empty; one that provokes a failure can read what was logged.
/// </summary>
internal sealed class TestLogger : ILoggerService
{
    private readonly ConcurrentQueue<TestLogEntry> _entries = new();

    /// <summary>Everything logged, in order.</summary>
    public IReadOnlyList<TestLogEntry> Entries => [.. _entries];

    /// <summary>The entries at error level or above.</summary>
    public IReadOnlyList<TestLogEntry> Errors => Entries.Where(e => e.Level >= LogLevel.Error).ToList();

    public void Log(LogLevel level, string category, string message, Exception? exception = null)
    {
        _entries.Enqueue(new TestLogEntry(level, category, message, exception));
        if (level >= LogLevel.Error)
            Console.Error.WriteLine($"[{level}] {category}: {message}{(exception is null ? string.Empty : Environment.NewLine + exception)}");
    }
}

internal sealed record TestLogEntry(LogLevel Level, string Category, string Message, Exception? Exception);
