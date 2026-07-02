using System;
using System.Threading;
using System.Threading.Tasks;

namespace Mnemo.UI.Services;

/// <summary>
/// Tracks keystroke timing for adaptive pause-to-send estimation
/// (<see cref="ChatPauseToSendEstimator"/>) and turns typing into a predictive
/// model warm-up signal: by the time the user hits Send, the chat models are
/// already loading (or loaded), hiding cold-start latency.
/// </summary>
public sealed class ChatTypingPrefetchHelper
{
    private readonly ChatPauseToSendEstimator _pauseEstimator;
    private readonly Action? _warmModels;
    private DateTime _lastKeystrokeUtc = DateTime.UtcNow;

    /// <param name="pauseEstimator">Adaptive pause-to-send estimator fed on every send.</param>
    /// <param name="warmModels">
    /// Optional warm-up hint invoked while the user types. Must be cheap and
    /// non-throwing (throttling is the callee's responsibility).
    /// </param>
    public ChatTypingPrefetchHelper(ChatPauseToSendEstimator pauseEstimator, Action? warmModels = null)
    {
        _pauseEstimator = pauseEstimator;
        _warmModels = warmModels;
    }

    /// <summary>Call when chat input text changes.</summary>
    public void NotifyInputChanged(bool isBusy)
    {
        _lastKeystrokeUtc = DateTime.UtcNow;
        if (!isBusy)
            _warmModels?.Invoke();
    }

    /// <summary>Call when the user commits send; records pause-to-send for adaptive idle delay.</summary>
    public async Task RecordSendPauseAsync(CancellationToken ct = default)
    {
        var pauseMs = (DateTime.UtcNow - _lastKeystrokeUtc).TotalMilliseconds;
        await _pauseEstimator.RecordPauseToSendSampleAsync(pauseMs, ct).ConfigureAwait(false);
    }
}
