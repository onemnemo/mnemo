using System;
using System.Diagnostics;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Services;

public readonly struct PerfDiagnosticsScope : IDisposable
{
    private readonly IPerfDiagnostics _perf;
    private readonly string _category;
    private readonly string _operation;
    private readonly string? _detail;
    private readonly long _startTicks;
    private readonly bool _active;

    public PerfDiagnosticsScope(IPerfDiagnostics perf, string category, string operation, string? detail = null)
    {
        _perf = perf;
        _category = category;
        _operation = operation;
        _detail = detail;
        _active = perf.IsEnabled;
        _startTicks = _active ? Stopwatch.GetTimestamp() : 0;
    }

    public void Dispose()
    {
        if (!_active)
            return;
        var ms = Stopwatch.GetElapsedTime(_startTicks).TotalMilliseconds;
        _perf.RecordTiming(_category, _operation, ms, _detail);
    }
}

public static class PerfDiagnosticsExtensions
{
    public static PerfDiagnosticsScope Measure(this IPerfDiagnostics perf, string category, string operation, string? detail = null)
        => new(perf, category, operation, detail);
}
