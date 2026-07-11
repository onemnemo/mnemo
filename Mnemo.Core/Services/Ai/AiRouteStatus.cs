namespace Mnemo.Core.Services.Ai;

/// <summary>
/// Why resolving a role did or didn't produce a binding. Routing-time knowledge only —
/// runtime failures (rejected key, network down) surface later as
/// <see cref="Mnemo.Core.Models.Ai.AiClientException"/> from the bound client.
/// </summary>
public enum AiRouteStatus
{
    /// <summary>A client and model are bound and ready to call.</summary>
    Available = 0,

    /// <summary>The configured provider requires an API key and none is set.</summary>
    MissingApiKey = 1,

    /// <summary>No client/model binding exists for the role under the current provider mode.</summary>
    NoBinding = 2,
}
