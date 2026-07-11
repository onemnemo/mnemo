using System;
using System.Collections.Generic;
using Mnemo.Core.Enums;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Tests.Ai;

/// <summary>Logger that records entries so tests can assert on category and level.</summary>
internal sealed class TestLogger : ILoggerService
{
    public List<(LogLevel Level, string Category, string Message, Exception? Exception)> Entries { get; } = new();

    public void Log(LogLevel level, string category, string message, Exception? exception = null)
        => Entries.Add((level, category, message, exception));
}
