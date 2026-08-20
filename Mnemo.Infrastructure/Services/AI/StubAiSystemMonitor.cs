using System;
using Mnemo.Core.Models;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Services.AI;

/// <summary>
/// Readiness monitor for the stub AI stack: always <see cref="AiSystemState.Ready"/>,
/// because the stub chat client has no models to load or warm. Replaced when a real
/// provider brings provider-aware readiness (key configured, service reachable).
/// </summary>
public sealed class StubAiSystemMonitor : IAiSystemMonitor
{
    /// <inheritdoc />
    public AiSystemState State => AiSystemState.Ready;

    /// <inheritdoc />
    // Never raised (readiness is constant), so the accessors are intentionally empty.
    public event EventHandler<AiSystemState>? StateChanged
    {
        add { }
        remove { }
    }

    /// <inheritdoc />
    public void WarmChatModels()
    {
        // Nothing to warm behind the stub client.
    }
}
