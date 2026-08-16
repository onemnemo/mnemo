using System;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.Host.Events;
using Mnemo.Infrastructure.Services.Updates;

namespace Mnemo.Host.Updates;

/// <summary>Where the update pipeline currently is. One value, so the SPA renders from a single field.</summary>
/// <remarks>
/// Serialized by name. The SPA branches on these strings, and the ordinals are not part of
/// any contract, so a value inserted in the middle of this list must not silently move
/// another one. The converter is declared here rather than on the whole host so no other
/// endpoint's shape changes with it.
/// </remarks>
[JsonConverter(typeof(JsonStringEnumConverter<UpdateStage>))]
public enum UpdateStage
{
    /// <summary>Nothing has been checked this session.</summary>
    Idle,
    Checking,
    /// <summary>A check completed and the selected channel had nothing newer.</summary>
    UpToDate,
    /// <summary>A newer build exists and has not been downloaded.</summary>
    Available,
    Downloading,
    /// <summary>Downloaded and staged; the next apply restarts into it.</summary>
    Ready,
    /// <summary>The last operation failed. <see cref="UpdateStatus.Error"/> says which.</summary>
    Failed,
}

/// <param name="Version">The running build, as the About row shows it.</param>
/// <param name="Channel">Normalised; never null even when nothing is stored.</param>
/// <param name="SupportsInAppApply">False for portable and unpackaged builds, which can only be told where to download.</param>
/// <param name="AwaitingChannelCatchUp">
/// The running build is less settled than the selected channel, so that channel has
/// nothing to offer until it reaches this version. Distinct from <see cref="UpdateStage.UpToDate"/>,
/// which would read as "you are on the newest Stable build" when the user is not.
/// </param>
/// <param name="Error">A code the SPA translates, not a sentence. Null unless the stage is Failed.</param>
public sealed record UpdateStatus(
    UpdateStage Stage,
    string Version,
    string Channel,
    bool SupportsInAppApply,
    bool AwaitingChannelCatchUp,
    DateTime? LastCheckedUtc,
    string? AvailableVersion,
    string? ReleaseNotesMarkdown,
    int DownloadProgress,
    string? Error);

/// <summary>
/// The check / download / apply state machine, and the only thing that talks to
/// <see cref="IUpdateService"/>.
/// </summary>
/// <remarks>
/// <para>
/// A singleton rather than per-request work because the interesting state is not in the
/// database: the Velopack update object resolved by a check is what a later download and
/// apply operate on, and it lives in the service instance. An endpoint that re-checked on
/// every call would also re-download.
/// </para>
/// <para>
/// Every transition is pushed over the event stream as a whole status rather than a delta.
/// The SPA then has one shape to render and no ordering to reconstruct, which matters
/// because download progress arrives faster than a React render.
/// </para>
/// </remarks>
public sealed class UpdateCoordinator
{
    /// <summary>How long an automatic check waits after the last one. Matches the desktop's gate.</summary>
    public static readonly TimeSpan AutoCheckCooldown = TimeSpan.FromHours(6);

    private readonly IUpdateService _updates;
    private readonly ISettingsService _settings;
    private readonly IAppEventPublisher _events;
    private readonly ILoggerService _logger;

    // One operation at a time. Two concurrent checks would race over the service's
    // pending-update field, and a download started twice would write the same file twice.
    private readonly SemaphoreSlim _gate = new(1, 1);

    private UpdateStage _stage = UpdateStage.Idle;
    private AppUpdateInfo? _available;
    private int _progress;
    private string? _error;
    private string? _channel;

    public UpdateCoordinator(
        IUpdateService updates,
        ISettingsService settings,
        IAppEventPublisher events,
        ILoggerService logger)
    {
        _updates = updates;
        _settings = settings;
        _events = events;
        _logger = logger;
    }

    public async Task<UpdateStatus> GetStatusAsync(CancellationToken cancellationToken = default)
    {
        var channel = await ReadChannelAsync(cancellationToken).ConfigureAwait(false);
        return BuildStatus(channel, await ReadLastCheckedAsync().ConfigureAwait(false));
    }

    /// <summary>
    /// Reads the selected channel, forgetting anything the previous one found.
    /// </summary>
    /// <remarks>
    /// The channel is a plain setting, written through the same endpoint as every other
    /// dropdown, so nothing tells this class the track changed. Noticing it here means
    /// every entry point notices it, because all three start by asking for the channel.
    /// <para>
    /// An in-flight or already staged download survives the switch. Those bytes are on
    /// disk and the user asked for them; discarding a finished download because a
    /// dropdown moved would be a worse surprise than installing the build they were
    /// already waiting on.
    /// </para>
    /// </remarks>
    private async Task<string> ReadChannelAsync(CancellationToken cancellationToken)
    {
        var channel = await _updates.GetChannelAsync(cancellationToken).ConfigureAwait(false);
        if (_channel is null || string.Equals(_channel, channel, StringComparison.Ordinal))
        {
            _channel = channel;
            return channel;
        }

        _channel = channel;
        if (_stage is UpdateStage.Downloading or UpdateStage.Ready)
            return channel;

        _available = null;
        _progress = 0;
        _error = null;
        _stage = UpdateStage.Idle;
        return channel;
    }

    /// <summary>
    /// Runs a check, or declines to when <paramref name="automatic"/> and the user has
    /// either turned automatic checks off or had one recently.
    /// </summary>
    /// <remarks>
    /// The gate lives here rather than in the caller so both the startup check and any
    /// future caller obey it. A declined automatic check is not an error: it answers with
    /// the status as it stands.
    /// </remarks>
    public async Task<UpdateStatus> CheckAsync(bool automatic, CancellationToken cancellationToken = default)
    {
        var channel = await ReadChannelAsync(cancellationToken).ConfigureAwait(false);
        var lastChecked = await ReadLastCheckedAsync().ConfigureAwait(false);

        if (automatic)
        {
            if (!await _settings.GetAsync(UpdateSettingsKeys.AutoCheck, true).ConfigureAwait(false))
                return BuildStatus(channel, lastChecked);

            if (lastChecked.HasValue && DateTime.UtcNow - lastChecked.Value < AutoCheckCooldown)
                return BuildStatus(channel, lastChecked);
        }

        // A download already in flight or staged is the more advanced state; re-checking
        // would discard the very update the user is waiting on.
        if (_stage is UpdateStage.Downloading or UpdateStage.Ready)
            return BuildStatus(channel, lastChecked);

        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            SetStage(UpdateStage.Checking, channel, lastChecked);

            var result = await _updates.CheckForUpdatesAsync(cancellationToken).ConfigureAwait(false);

            lastChecked = DateTime.UtcNow;
            await _settings.SetAsync(UpdateSettingsKeys.LastCheckedUtc, lastChecked).ConfigureAwait(false);

            if (!result.IsSuccess)
            {
                _logger.Warning("Updates", $"Update check failed: {result.ErrorMessage}");
                _available = null;
                _error = "check_failed";
                SetStage(UpdateStage.Failed, channel, lastChecked);
                return BuildStatus(channel, lastChecked);
            }

            _error = null;
            _available = result.Value;
            SetStage(_available is null ? UpdateStage.UpToDate : UpdateStage.Available, channel, lastChecked);
            return BuildStatus(channel, lastChecked);
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>
    /// Starts downloading the pending update and returns immediately.
    /// </summary>
    /// <remarks>
    /// Not awaited by the request: a self-contained build is a few hundred megabytes, and
    /// a response held open for that long is a request the SPA has to nurse through a
    /// timeout. Progress and the final stage arrive over the event stream instead.
    /// </remarks>
    public async Task<UpdateStatus> BeginDownloadAsync(CancellationToken cancellationToken = default)
    {
        var channel = await ReadChannelAsync(cancellationToken).ConfigureAwait(false);
        var lastChecked = await ReadLastCheckedAsync().ConfigureAwait(false);

        if (_stage is UpdateStage.Downloading or UpdateStage.Ready || _available is null)
            return BuildStatus(channel, lastChecked);

        var update = _available;
        _progress = 0;
        _error = null;
        SetStage(UpdateStage.Downloading, channel, lastChecked);

        // Detached from the request on purpose, so its cancellation token cannot abort a
        // download because the caller navigated away.
        _ = Task.Run(() => RunDownloadAsync(update, channel), CancellationToken.None);
        return BuildStatus(channel, lastChecked);
    }

    private async Task RunDownloadAsync(AppUpdateInfo update, string channel)
    {
        await _gate.WaitAsync().ConfigureAwait(false);
        try
        {
            var lastChecked = await ReadLastCheckedAsync().ConfigureAwait(false);

            // Reported only when the whole number changes: Velopack raises this per chunk,
            // and an event per chunk would be thousands of SSE frames for one download.
            var progress = new Progress<int>(percent =>
            {
                var clamped = Math.Clamp(percent, 0, 100);
                if (clamped == _progress)
                    return;

                _progress = clamped;
                Publish(BuildStatus(channel, lastChecked));
            });

            var result = await _updates.DownloadUpdatesAsync(update, progress).ConfigureAwait(false);
            if (!result.IsSuccess)
            {
                _logger.Warning("Updates", $"Update download failed: {result.ErrorMessage}");
                _error = "download_failed";
                SetStage(UpdateStage.Failed, channel, lastChecked);
                return;
            }

            _progress = 100;
            SetStage(UpdateStage.Ready, channel, lastChecked);
        }
        catch (Exception ex)
        {
            _logger.Error("Updates", "Update download threw.", ex);
            _error = "download_failed";
            SetStage(UpdateStage.Failed, channel, await ReadLastCheckedAsync().ConfigureAwait(false));
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>True when there is a staged update to restart into.</summary>
    public bool CanApply => _stage == UpdateStage.Ready;

    /// <summary>
    /// Restarts into the staged update. Does not return: the process is replaced.
    /// </summary>
    public void Apply() => _updates.ApplyUpdatesAndRestart();

    private void SetStage(UpdateStage stage, string channel, DateTime? lastChecked)
    {
        _stage = stage;
        Publish(BuildStatus(channel, lastChecked));
    }

    private void Publish(UpdateStatus status) => _events.Publish(new AppEvent("update-status", status));

    private UpdateStatus BuildStatus(string channel, DateTime? lastChecked)
    {
        var version = _updates.CurrentDisplayVersion;
        return new UpdateStatus(
            _stage,
            version,
            channel,
            _updates.SupportsInAppApply,
            UpdateChannels.IsAwaitingCatchUp(channel, VelopackUpdateService.ParseVersion(version)),
            lastChecked,
            _available?.Version,
            _available?.ReleaseNotesMarkdown,
            _progress,
            _error);
    }

    private Task<DateTime?> ReadLastCheckedAsync() =>
        _settings.GetAsync<DateTime?>(UpdateSettingsKeys.LastCheckedUtc);
}
