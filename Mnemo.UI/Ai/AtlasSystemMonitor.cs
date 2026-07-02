using System;
using System.Collections.Generic;
using Atlas.Core.Inference;
using Atlas.Core.Serving;
using Mnemo.Core.Models;
using Mnemo.Core.Services;

namespace Mnemo.UI.Ai;

/// <summary>
/// The Atlas-backed <see cref="IAiSystemMonitor"/>: folds per-model lifecycle
/// events into one aggregated readiness state and forwards chat warm-up hints
/// to the models that serve a chat turn (router + main worker).
/// </summary>
public sealed class AtlasSystemMonitor : IAiSystemMonitor, IDisposable
{
    /// <summary>Minimum interval between forwarded warm-up hints (they arrive per keystroke).</summary>
    private static readonly TimeSpan WarmThrottle = TimeSpan.FromSeconds(10);

    private readonly IModelServerLifecycle _lifecycle;
    private readonly IModelWarmup _warmup;
    private readonly ILoggerService _logger;
    private readonly object _gate = new();
    private AiSystemState _state;
    private DateTime _lastWarmUtc = DateTime.MinValue;
    private bool _disposed;

    public AtlasSystemMonitor(IModelServerLifecycle lifecycle, IModelWarmup warmup, ILoggerService logger)
    {
        _lifecycle = lifecycle;
        _warmup = warmup;
        _logger = logger;
        _lifecycle.StatusChanged += OnLifecycleStatusChanged;
        _state = Aggregate(_lifecycle.GetStatuses());
    }

    /// <inheritdoc />
    public AiSystemState State
    {
        get
        {
            lock (_gate)
            {
                return _state;
            }
        }
    }

    /// <inheritdoc />
    public event EventHandler<AiSystemState>? StateChanged;

    /// <inheritdoc />
    public void WarmChatModels()
    {
        lock (_gate)
        {
            if (_disposed || DateTime.UtcNow - _lastWarmUtc < WarmThrottle)
                return;
            _lastWarmUtc = DateTime.UtcNow;
        }

        try
        {
            _warmup.RequestWarm(ModelRole.Router);
            _warmup.RequestWarm(ModelRole.MainWorker);
        }
        catch (Exception ex)
        {
            // A failed hint must never disturb typing; the models still load on demand.
            _logger.Warning("AtlasSystemMonitor", $"Warm-up hint failed: {ex.Message}");
        }
    }

    private void OnLifecycleStatusChanged(object? sender, ModelServerStatusChangedEventArgs e)
    {
        AiSystemState next = Aggregate(_lifecycle.GetStatuses());

        lock (_gate)
        {
            if (_disposed || next == _state)
                return;
            _state = next;
        }

        StateChanged?.Invoke(this, next);
    }

    private static AiSystemState Aggregate(IReadOnlyList<ModelServerStatus> statuses)
    {
        var anyWarming = false;
        foreach (ModelServerStatus status in statuses)
        {
            if (status.IsReady)
                return AiSystemState.Ready;
            if (status.State is ModelServerState.Starting or ModelServerState.Warming)
                anyWarming = true;
        }

        return anyWarming ? AiSystemState.Warming : AiSystemState.Offline;
    }

    public void Dispose()
    {
        lock (_gate)
        {
            if (_disposed) return;
            _disposed = true;
        }

        _lifecycle.StatusChanged -= OnLifecycleStatusChanged;
    }
}
