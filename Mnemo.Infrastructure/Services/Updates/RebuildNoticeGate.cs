namespace Mnemo.Infrastructure.Services.Updates;

/// <summary>
/// Once-per-launch gate for the notice that points this release line at the rebuilt app.
/// The notice is armed after the startup flows have run, then claimed the first time an
/// allowed route is current. A manual check can show the notice at any time and marks it
/// shown so the automatic presentation stays quiet for the rest of the launch.
/// </summary>
public sealed class RebuildNoticeGate
{
    private bool _armed;
    private bool _shown;

    public bool IsShown => _shown;

    /// <summary>Startup flows have finished; the notice may appear on the next allowed route.</summary>
    public void Arm() => _armed = true;

    /// <summary>True exactly once per launch: the first time an allowed route is current after arming.</summary>
    public bool TryClaim(string? route)
    {
        if (!_armed || _shown || !UpdateGatePolicy.IsAllowedRoute(route))
            return false;

        _shown = true;
        return true;
    }

    /// <summary>The notice was shown by another path (a manual check); the automatic one stays quiet.</summary>
    public void MarkShown() => _shown = true;
}
