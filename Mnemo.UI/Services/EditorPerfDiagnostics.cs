using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using Avalonia;
using Avalonia.Threading;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services;

namespace Mnemo.UI.Services;

/// <summary>Block-editor perf helpers: resolve <see cref="IPerfDiagnostics"/>, slow-path timings, keystroke aggregation.</summary>
public static class EditorPerfDiagnostics
{
    private const double SlowPathThresholdMs = 12;

    private static readonly object ContentChangeLock = new();
    private static int _contentChangeCount;
    private static double _contentChangeMaxMs;
    private static double _contentChangeSumMs;

    private static readonly object InteractionLock = new();
    private static readonly Dictionary<string, InteractionMetric> InteractionMetrics = new(StringComparer.Ordinal);
    private static DispatcherTimer? _interactionFlushDebounce;
    private static IPerfDiagnostics? _cached;

    /// <summary>Lazy resolve from <see cref="App.Services"/>; null until bootstrap completes.</summary>
    public static IPerfDiagnostics? Resolve()
    {
        if (_cached != null)
            return _cached;

        if (Application.Current is App app)
            _cached = app.Services?.GetService(typeof(IPerfDiagnostics)) as IPerfDiagnostics;

        return _cached;
    }

    /// <summary>Records a sub-phase when it exceeds <see cref="SlowPathThresholdMs"/>.</summary>
    public static void RecordPhase(IPerfDiagnostics? perf, long phaseStartTicks, string operation, string? detail = null)
    {
        if (perf is not { IsEnabled: true } || phaseStartTicks == 0)
            return;
        RecordIfSlow(perf, operation, ElapsedMs(phaseStartTicks), detail);
    }

    public static PerfDiagnosticsScope Measure(IPerfDiagnostics? perf, string operation, string? detail = null) =>
        perf is { IsEnabled: true }
            ? perf.Measure("NotesEditor", operation, detail)
            : default;

    public static void RecordIfSlow(IPerfDiagnostics? perf, string operation, double milliseconds, string? detail = null)
    {
        if (perf is not { IsEnabled: true } || milliseconds < SlowPathThresholdMs)
            return;
        perf.RecordTiming("NotesEditor", operation, milliseconds, detail);
    }

    /// <summary>Aggregate per-keystroke content-change cost; flushed by <see cref="FlushContentChangeMetrics"/>.</summary>
    public static void ReportContentChange(double milliseconds)
    {
        lock (ContentChangeLock)
        {
            _contentChangeCount++;
            _contentChangeSumMs += milliseconds;
            if (milliseconds > _contentChangeMaxMs)
                _contentChangeMaxMs = milliseconds;
        }
    }

    public static void FlushContentChangeMetrics(IPerfDiagnostics? perf)
    {
        if (perf is not { IsEnabled: true })
            return;

        int count;
        double maxMs;
        double avgMs;
        lock (ContentChangeLock)
        {
            count = _contentChangeCount;
            maxMs = _contentChangeMaxMs;
            avgMs = count > 0 ? _contentChangeSumMs / count : 0;
            _contentChangeCount = 0;
            _contentChangeMaxMs = 0;
            _contentChangeSumMs = 0;
        }

        if (count == 0)
            return;

        perf.RecordMetric("NotesEditor", "contentChange.count", count, detail: "per debounce window");
        perf.RecordMetric("NotesEditor", "contentChange.avgMs", avgMs, unit: "ms");
        perf.RecordMetric("NotesEditor", "contentChange.maxMs", maxMs, unit: "ms");
    }

    /// <summary>
    /// Aggregates high-frequency editor events (pointer move, render, layout) without logging
    /// every event. Slow individual events are still recorded immediately with their detail.
    /// </summary>
    public static void ReportInteraction(
        IPerfDiagnostics? perf,
        string operation,
        double milliseconds,
        string? detail = null,
        double slowThresholdMs = SlowPathThresholdMs)
    {
        if (perf is not { IsEnabled: true })
            return;

        lock (InteractionLock)
        {
            ref var metric = ref CollectionsMarshal.GetValueRefOrAddDefault(InteractionMetrics, operation, out _);
            metric.Count++;
            metric.SumMs += milliseconds;
            if (milliseconds > metric.MaxMs)
            {
                metric.MaxMs = milliseconds;
                metric.MaxDetail = detail;
            }
        }

        if (milliseconds >= slowThresholdMs)
            perf.RecordTiming("NotesEditor", operation, milliseconds, detail);

        ScheduleInteractionFlush(perf);
    }

    private static void ScheduleInteractionFlush(IPerfDiagnostics perf)
    {
        if (!Dispatcher.UIThread.CheckAccess())
        {
            Dispatcher.UIThread.Post(() => ScheduleInteractionFlush(perf), DispatcherPriority.Background);
            return;
        }

        _interactionFlushDebounce ??= new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(400) };
        _interactionFlushDebounce.Tick -= OnInteractionFlushDebounceTick;
        _interactionFlushDebounce.Tick += OnInteractionFlushDebounceTick;
        _interactionFlushDebounce.Stop();
        _interactionFlushDebounce.Start();

        static void OnInteractionFlushDebounceTick(object? sender, EventArgs e)
        {
            _interactionFlushDebounce?.Stop();
            var perf = Resolve();
            FlushInteractionMetrics(perf);
            FlushContentChangeMetrics(perf);
        }
    }

    public static void FlushInteractionMetrics(IPerfDiagnostics? perf)
    {
        if (perf is not { IsEnabled: true })
            return;

        List<(string Operation, int Count, double AvgMs, double MaxMs, string? MaxDetail)> snapshot;
        lock (InteractionLock)
        {
            if (InteractionMetrics.Count == 0)
                return;

            snapshot = new List<(string, int, double, double, string?)>(InteractionMetrics.Count);
            foreach (var kv in InteractionMetrics)
            {
                var m = kv.Value;
                var avg = m.Count > 0 ? m.SumMs / m.Count : 0;
                snapshot.Add((kv.Key, m.Count, avg, m.MaxMs, m.MaxDetail));
            }
            InteractionMetrics.Clear();
        }

        foreach (var item in snapshot)
        {
            perf.RecordMetric("NotesEditor", $"{item.Operation}.count", item.Count, detail: "per debounce window");
            perf.RecordMetric("NotesEditor", $"{item.Operation}.avgMs", item.AvgMs, unit: "ms");
            perf.RecordMetric("NotesEditor", $"{item.Operation}.maxMs", item.MaxMs, unit: "ms", item.MaxDetail);
        }
    }

    public static double ElapsedMs(long startTicks) =>
        Stopwatch.GetElapsedTime(startTicks).TotalMilliseconds;

    private struct InteractionMetric
    {
        public int Count;
        public double SumMs;
        public double MaxMs;
        public string? MaxDetail;
    }
}
