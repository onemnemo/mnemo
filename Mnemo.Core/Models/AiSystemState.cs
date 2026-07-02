namespace Mnemo.Core.Models;

/// <summary>
/// Aggregated readiness of the local AI system, for lightweight status
/// indicators (e.g. the model pill in the chat composer).
/// </summary>
public enum AiSystemState
{
    /// <summary>No model backend is loaded or loading.</summary>
    Offline = 0,

    /// <summary>At least one model backend is starting or loading weights.</summary>
    Warming = 1,

    /// <summary>At least one model backend is loaded and serving.</summary>
    Ready = 2,
}
