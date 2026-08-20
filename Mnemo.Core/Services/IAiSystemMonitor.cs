using System;
using Mnemo.Core.Models;

namespace Mnemo.Core.Services;

/// <summary>
/// Observes the local AI system's readiness and accepts predictive warm-up
/// hints, so UI surfaces can show live status and hide model-load latency
/// behind user intent (opening an AI view, starting to type).
/// </summary>
public interface IAiSystemMonitor
{
    /// <summary>The current aggregated readiness.</summary>
    AiSystemState State { get; }

    /// <summary>
    /// Raised when <see cref="State"/> changes. May be raised on any thread;
    /// subscribers marshal to the UI thread themselves.
    /// </summary>
    event EventHandler<AiSystemState>? StateChanged;

    /// <summary>
    /// Hints that the user is about to use the chat assistant, so the models
    /// behind it should start loading now. Fire-and-forget, throttled
    /// internally, and never throws. Callers may invoke it on every keystroke.
    /// </summary>
    void WarmChatModels();
}
