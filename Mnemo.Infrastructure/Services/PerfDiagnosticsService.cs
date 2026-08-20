using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Text;
using System.Threading.Tasks;
using Mnemo.Core.Models;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Services;

public sealed class PerfDiagnosticsService : IPerfDiagnostics
{
    private const int MaxEntries = 500;

    private readonly ISettingsService _settingsService;
    private readonly ILoggerService _logger;
    private readonly object _lock = new();
    private readonly List<PerfDiagnosticsEntry> _entries = new(MaxEntries);
    private volatile bool _enabled;

    public PerfDiagnosticsService(ISettingsService settingsService, ILoggerService logger)
    {
        _settingsService = settingsService;
        _logger = logger;
        _settingsService.SettingChanged += OnSettingChanged;
        _ = RefreshEnabledAsync();
    }

    public bool IsEnabled => _enabled;

    public void RecordTiming(string category, string operation, double milliseconds, string? detail = null)
    {
        var isStartup = string.Equals(category, "Startup", StringComparison.Ordinal);
        if (!_enabled && !isStartup)
            return;

        var entry = new PerfDiagnosticsEntry(
            DateTimeOffset.Now,
            PerfDiagnosticsKind.Timing,
            category,
            operation,
            $"{milliseconds:0.###} ms",
            detail);

        Append(entry);
        Emit(entry, $"{category}/{operation}: {milliseconds:0.###} ms{(detail != null ? $" ({detail})" : "")}");
    }

    public void RecordMetric(string category, string name, double value, string? unit = null, string? detail = null)
    {
        if (!_enabled)
            return;

        var valueText = unit != null ? $"{value:0.##} {unit}" : $"{value:0.##}";
        var entry = new PerfDiagnosticsEntry(
            DateTimeOffset.Now,
            PerfDiagnosticsKind.Metric,
            category,
            name,
            valueText,
            detail);

        Append(entry);
        Emit(entry, $"{category}/{name}: {valueText}{(detail != null ? $" ({detail})" : "")}");
    }

    public void CaptureMemorySnapshot(string label, string? detail = null)
    {
        if (!_enabled)
            return;

        var managedMb = GC.GetTotalMemory(forceFullCollection: false) / (1024.0 * 1024.0);
        long workingSetMb = 0;
        try
        {
            using var process = Process.GetCurrentProcess();
            workingSetMb = process.WorkingSet64 / (1024 * 1024);
        }
        catch
        {
            // Ignore if process metrics are unavailable.
        }

        var gcInfo = $"Gen0={GC.CollectionCount(0)} Gen1={GC.CollectionCount(1)} Gen2={GC.CollectionCount(2)}";
        var value = workingSetMb > 0
            ? $"managed {managedMb:0.#} MB, WS {workingSetMb} MB"
            : $"managed {managedMb:0.#} MB";

        var entry = new PerfDiagnosticsEntry(
            DateTimeOffset.Now,
            PerfDiagnosticsKind.Memory,
            "Memory",
            label,
            value,
            string.IsNullOrEmpty(detail) ? gcInfo : $"{detail}; {gcInfo}");

        Append(entry);
        Emit(entry, $"Memory/{label}: {value} ({gcInfo})");
    }

    public IReadOnlyList<PerfDiagnosticsEntry> GetRecentEntries(int maxCount = 250)
    {
        lock (_lock)
        {
            var take = Math.Min(maxCount, _entries.Count);
            if (take == 0)
                return Array.Empty<PerfDiagnosticsEntry>();
            return _entries.GetRange(_entries.Count - take, take);
        }
    }

    public string FormatReport(int maxEntries = 250)
    {
        var snapshot = GetRecentEntries(maxEntries);
        if (snapshot.Count == 0)
            return "No performance diagnostics recorded yet.";

        var sb = new StringBuilder();
        sb.AppendLine($"Performance diagnostics (last {snapshot.Count} entries, newest last)");
        sb.AppendLine(new string('-', 72));
        foreach (var e in snapshot)
        {
            var time = e.Timestamp.ToLocalTime().ToString("HH:mm:ss.fff");
            sb.Append('[').Append(time).Append("] ");
            sb.Append(e.Kind).Append(' ').Append(e.Category).Append('/').Append(e.Name);
            sb.Append(": ").Append(e.Value);
            if (!string.IsNullOrEmpty(e.Detail))
                sb.Append(" — ").Append(e.Detail);
            sb.AppendLine();
        }
        return sb.ToString();
    }

    public void Clear()
    {
        lock (_lock)
            _entries.Clear();
    }

    private void Append(PerfDiagnosticsEntry entry)
    {
        lock (_lock)
        {
            _entries.Add(entry);
            if (_entries.Count > MaxEntries)
                _entries.RemoveRange(0, _entries.Count - MaxEntries);
        }
    }

    private void Emit(PerfDiagnosticsEntry entry, string message)
    {
        if (!_enabled)
            return;

        _logger.Debug("Perf", message);
        var time = entry.Timestamp.ToLocalTime().ToString("HH:mm:ss.fff");
        Console.WriteLine($"[Perf] [{time}] {entry.Kind} {message}");
    }

    private async void OnSettingChanged(object? sender, string key)
    {
        if (key != IPerfDiagnostics.EnabledSettingKey)
            return;
        await RefreshEnabledAsync().ConfigureAwait(false);
    }

    private async Task RefreshEnabledAsync()
    {
        try
        {
            _enabled = await _settingsService.GetAsync(IPerfDiagnostics.EnabledSettingKey, false).ConfigureAwait(false);
            if (_enabled)
                CaptureMemorySnapshot("diagnostics enabled");
        }
        catch
        {
            _enabled = false;
        }
    }
}
