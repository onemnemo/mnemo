using System;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models;

namespace Mnemo.Core.Services;

/// <summary>Checks and applies updates (Velopack when installed; GitHub-only when portable).</summary>
public interface IUpdateService
{
    /// <summary>True when Velopack can download and apply updates in-process (installed, non-portable Velopack layout).</summary>
    bool SupportsInAppApply { get; }

    /// <summary>Current app version string for display and comparison (informational / semantic).</summary>
    string CurrentDisplayVersion { get; }

    /// <summary>The update track this install follows, normalised. Stored as a setting, so it is read rather than held.</summary>
    Task<string> GetChannelAsync(CancellationToken cancellationToken = default);

    /// <summary>Returns null when no newer version is available.</summary>
    Task<Result<AppUpdateInfo?>> CheckForUpdatesAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Downloads packages for the update <see cref="CheckForUpdatesAsync"/> resolved in this
    /// instance. Fails without touching the network when no check has run here, or when the
    /// version asked for is not the one that check resolved.
    /// </summary>
    Task<Result> DownloadUpdatesAsync(AppUpdateInfo update, IProgress<int>? progress, CancellationToken cancellationToken = default);

    /// <summary>Restarts the app and applies a downloaded update. No-op if nothing pending.</summary>
    void ApplyUpdatesAndRestart();
}
