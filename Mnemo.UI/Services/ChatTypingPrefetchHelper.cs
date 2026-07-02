using System;
using System.Threading;
using System.Threading.Tasks;

namespace Mnemo.UI.Services;

/// <summary>
/// Tracks keystroke timing for adaptive pause-to-send estimation (<see cref="ChatPauseToSendEstimator"/>).
/// Typing prefetch / model warm-up was removed so local llama starts on first Send.
/// </summary>
public sealed class ChatTypingPrefetchHelper
{
    private readonly ChatPauseToSendEstimator _pauseEstimator;
    private DateTime _lastKeystrokeUtc = DateTime.UtcNow;

    public ChatTypingPrefetchHelper(ChatPauseToSendEstimator pauseEstimator)
    {
        _pauseEstimator = pauseEstimator;
    }

    /// <summary>Call when chat input text changes.</summary>
    public void NotifyInputChanged(bool isBusy)
    {
        _lastKeystrokeUtc = DateTime.UtcNow;
    }

    /// <summary>Call when the user commits send; records pause-to-send for adaptive idle delay.</summary>
    public async Task RecordSendPauseAsync(CancellationToken ct = default)
    {
        var pauseMs = (DateTime.UtcNow - _lastKeystrokeUtc).TotalMilliseconds;
        await _pauseEstimator.RecordPauseToSendSampleAsync(pauseMs, ct).ConfigureAwait(false);
    }
}
