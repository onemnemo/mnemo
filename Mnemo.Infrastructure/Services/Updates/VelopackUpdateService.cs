using System;
using System.Net.Http;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using NuGet.Versioning;
using Velopack;
using Velopack.Exceptions;
using Velopack.Locators;
using Velopack.Sources;

namespace Mnemo.Infrastructure.Services.Updates;

public sealed class VelopackUpdateService : IUpdateService, IDisposable
{
    /// <summary>
    /// Releases are the feed. Velopack reads <c>releases.{channel}.json</c> from the
    /// assets of recent releases here, so publishing a release publishes the feed with
    /// it, and switching channels stays a client-side choice rather than a reinstall.
    /// </summary>
    /// <remarks>
    /// Not a static site on GitHub Pages: update feeds only grow, every full package is
    /// north of a hundred megabytes, and Pages allows a gigabyte for the whole site, so that
    /// arrangement has a release count it cannot survive. Release assets have no such ceiling.
    /// </remarks>
    private const string RepoUrl = "https://github.com/onemnemo/mnemo";

    /// <summary>Newest first, prereleases included; the channel filter is applied here rather than by the API.</summary>
    private static readonly Uri ReleasesApi = new("https://api.github.com/repos/onemnemo/mnemo/releases?per_page=30");

    /// <summary>
    /// Velopack in-process download/apply: Windows portable (unzipped) builds are excluded; Linux/macOS AppImage/.app use the feed when installed.
    /// </summary>
    private static bool CanUseVelopackOnlineUpdate(UpdateManager um) =>
        um.IsInstalled && (!OperatingSystem.IsWindows() || !um.IsPortable);

    private readonly ILoggerService _logger;
    private readonly ISettingsService _settings;
    private readonly HttpClient _httpClient;
    private UpdateManager? _updateManager;
    private string? _updateManagerChannel;
    private Velopack.UpdateInfo? _pendingVelopackUpdate;

    private readonly SemaphoreSlim _seedGate = new(1, 1);
    private bool _channelSeeded;

    public VelopackUpdateService(ILoggerService logger, ISettingsService settings)
    {
        _logger = logger;
        _settings = settings;
        _httpClient = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
        _httpClient.DefaultRequestHeaders.UserAgent.ParseAdd("MnemoDesktop/1.0 (update-check)");
    }

    public void Dispose()
    {
        _httpClient.Dispose();
        _seedGate.Dispose();
    }

    public async Task<string> GetChannelAsync(CancellationToken cancellationToken = default)
    {
        await EnsureChannelSeededAsync(cancellationToken).ConfigureAwait(false);
        var stored = await _settings.GetAsync<string?>(UpdateSettingsKeys.Channel).ConfigureAwait(false);
        return UpdateChannels.Normalize(stored);
    }

    /// <summary>
    /// Serializes channel initialization before reads. A failed seed is logged and attempted at
    /// most once per process.
    /// </summary>
    private async Task EnsureChannelSeededAsync(CancellationToken cancellationToken)
    {
        await _seedGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            if (_channelSeeded)
                return;

            // Set before the work rather than after: this runs at most once per process
            // either way, and a seed that threw must not be retried on every channel read.
            _channelSeeded = true;
            await SeedChannelIfAbsentAsync(ResolveInstalledChannel).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            _logger.Warning("Updates", $"Could not seed the update channel: {ex.Message}");
        }
        finally
        {
            _seedGate.Release();
        }
    }

    /// <summary>
    /// Seeds an absent channel setting from the installed package. Unknown channels remain unset,
    /// and existing choices are never overwritten.
    /// </summary>
    /// <returns>True when a value was written.</returns>
    internal async Task<bool> SeedChannelIfAbsentAsync(Func<string?> installedChannel)
    {
        if (await _settings.ExistsAsync(UpdateSettingsKeys.Channel).ConfigureAwait(false))
            return false;

        var channel = installedChannel();
        if (channel is null)
            return false;

        await _settings.SetAsync(UpdateSettingsKeys.Channel, channel).ConfigureAwait(false);
        _logger.Info("Updates", $"First run adopted the installed update channel '{channel}'.");
        return true;
    }

    /// <summary>
    /// Reads the installed channel from Velopack. Returns null outside an installed layout and logs
    /// unavailable metadata once per profile for diagnosis.
    /// </summary>
    private string? ResolveInstalledChannel()
    {
        if (!VelopackLocator.IsCurrentSet)
        {
            _logger.Info("Updates", "No update channel to adopt: this process has no Velopack locator.");
            return null;
        }

        var locator = VelopackLocator.Current;
        var installed = ParseVersion(locator.CurrentlyInstalledVersion?.ToString());
        if (installed is null)
        {
            _logger.Info("Updates", "No update channel to adopt: this build is not an installed package.");
            return null;
        }

        // Published packages declare a channel; do not infer one when package metadata omits it.
        if (string.IsNullOrWhiteSpace(locator.Channel))
        {
            _logger.Info("Updates", "No update channel to adopt: the locator reports no channel.");
            return null;
        }

        var fromLocator = UpdateChannels.ChannelFromFeedName(locator.Channel);
        if (fromLocator is not null)
            return fromLocator;

        // Fall back to a recognized prerelease label. Leave Stable unset because it is already the
        // default.
        var inferred = UpdateChannels.ForVersion(installed);
        if (!string.Equals(inferred, UpdateChannels.Stable, StringComparison.Ordinal))
            return inferred;

        _logger.Info(
            "Updates",
            $"No update channel to adopt: the locator reports '{locator.Channel}' for version {installed}.");
        return null;
    }

    /// <summary>
    /// The manager for a channel, rebuilt when the channel changes.
    /// </summary>
    /// <remarks>
    /// The channel is baked into the manager's options rather than passed per call, so a
    /// switch has to replace it. Any update discovered under the previous channel is
    /// dropped at the same time: it was resolved against a feed the user is no longer
    /// following, and applying it would install from a track they just left.
    /// </remarks>
    private UpdateManager GetOrCreateUpdateManager(string channel)
    {
        if (_updateManager != null && string.Equals(_updateManagerChannel, channel, StringComparison.Ordinal))
            return _updateManager;

        _pendingVelopackUpdate = null;
        _updateManagerChannel = channel;

        // Velopack reads the ten most recent releases and skips any without an index for
        // this channel. Stable asks for finished releases only, so a run of prereleases
        // can never crowd its packages out of that window.
        var seesPrereleases = !string.Equals(channel, UpdateChannels.Stable, StringComparison.Ordinal);
        _updateManager = new UpdateManager(
            new GithubSource(RepoUrl, accessToken: null, prerelease: seesPrereleases),
            new UpdateOptions
            {
                ExplicitChannel = UpdateChannels.FeedName(RuntimeInformation.RuntimeIdentifier, channel),
            },
            locator: null);
        return _updateManager;
    }

    /// <summary>For the two synchronous members, which describe the local install and do not depend on the feed.</summary>
    private UpdateManager GetLocalUpdateManager() =>
        GetOrCreateUpdateManager(_updateManagerChannel ?? UpdateChannels.Stable);

    public bool SupportsInAppApply
    {
        get
        {
            try
            {
                return CanUseVelopackOnlineUpdate(GetLocalUpdateManager());
            }
            catch (Exception ex)
            {
                _logger.Warning("Updates", $"SupportsInAppApply probe failed: {ex.Message}");
                return false;
            }
        }
    }

    public string CurrentDisplayVersion
    {
        get
        {
            try
            {
                var um = GetLocalUpdateManager();
                if (um.CurrentVersion != null)
                    return um.CurrentVersion.ToString();
            }
            catch
            {
                // fall through
            }

            return ReadInformationalVersionFromEntryAssembly();
        }
    }

    public async Task<Result<AppUpdateInfo?>> CheckForUpdatesAsync(CancellationToken cancellationToken = default)
    {
        _pendingVelopackUpdate = null;

        try
        {
            var channel = await GetChannelAsync(cancellationToken).ConfigureAwait(false);
            var um = GetOrCreateUpdateManager(channel);
            if (CanUseVelopackOnlineUpdate(um))
            {
                try
                {
                    var vp = await um.CheckForUpdatesAsync().ConfigureAwait(false);
                    if (vp == null)
                        return Result<AppUpdateInfo?>.Success(null);

                    _pendingVelopackUpdate = vp;
                    var asset = vp.TargetFullRelease;
                    var info = new AppUpdateInfo(
                        asset.Version.ToString(),
                        asset.NotesMarkdown,
                        publishedAtUtc: null,
                        isMandatory: false);
                    return Result<AppUpdateInfo?>.Success(info);
                }
                catch (NotInstalledException)
                {
                    // Fall through to GitHub API (same as unpackaged / portable).
                }
            }

            return await CheckPortableViaGithubAsync(um, channel, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            _logger.Warning("Updates", $"CheckForUpdatesAsync failed: {ex.Message}");
            return Result<AppUpdateInfo?>.Failure(ex.Message, ex);
        }
    }

    /// <summary>
    /// The unpackaged and portable path: no Velopack feed to read, so the release list
    /// stands in for one.
    /// </summary>
    /// <remarks>
    /// The whole list rather than <c>/releases/latest</c>, because that endpoint skips
    /// prereleases entirely (so Beta and Nightly would never see anything) and, when it
    /// does answer, answers with the newest release regardless of track. The channel
    /// filter has to be applied on this side either way.
    /// </remarks>
    private async Task<Result<AppUpdateInfo?>> CheckPortableViaGithubAsync(
        UpdateManager um,
        string channel,
        CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, ReleasesApi);
        using var response = await _httpClient.SendAsync(request, cancellationToken).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
            return Result<AppUpdateInfo?>.Failure($"GitHub API {(int)response.StatusCode}: {body}");
        }

        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
        using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken).ConfigureAwait(false);
        if (doc.RootElement.ValueKind != JsonValueKind.Array)
            return Result<AppUpdateInfo?>.Failure("GitHub returned no release list.");

        var current = ResolveSemanticCurrentVersion(um);
        SemanticVersion? bestVersion = null;
        JsonElement best = default;

        foreach (var release in doc.RootElement.EnumerateArray())
        {
            if (release.TryGetProperty("draft", out var draft) && draft.ValueKind == JsonValueKind.True)
                continue;

            if (!release.TryGetProperty("tag_name", out var tagEl))
                continue;

            var tag = (tagEl.GetString() ?? string.Empty).TrimStart('v', 'V');
            if (!SemanticVersion.TryParse(tag, out var version))
                continue;

            if (!UpdateChannels.Offers(channel, UpdateChannels.ForVersion(version)))
                continue;

            if (bestVersion == null || version > bestVersion)
            {
                bestVersion = version;
                best = release;
            }
        }

        if (bestVersion == null || (current != null && bestVersion <= current))
            return Result<AppUpdateInfo?>.Success(null);

        var notes = best.TryGetProperty("body", out var bodyEl) ? bodyEl.GetString() : null;
        DateTime? published = null;
        if (best.TryGetProperty("published_at", out var pubEl)
            && pubEl.GetString() is { Length: > 0 } publishedText
            && DateTime.TryParse(publishedText, out var parsedDate))
        {
            published = parsedDate;
        }

        return Result<AppUpdateInfo?>.Success(
            new AppUpdateInfo(bestVersion.ToString(), notes, published, isMandatory: false));
    }

    private static SemanticVersion? ResolveSemanticCurrentVersion(UpdateManager um)
    {
        if (um.CurrentVersion != null && SemanticVersion.TryParse(um.CurrentVersion.ToString(), out var vp))
            return vp;

        return ParseVersion(ReadInformationalVersionFromEntryAssembly());
    }

    /// <summary>Parses an informational version, tolerating the build metadata a CI build appends.</summary>
    public static SemanticVersion? ParseVersion(string? version)
    {
        if (string.IsNullOrWhiteSpace(version))
            return null;

        if (SemanticVersion.TryParse(version, out var parsed))
            return parsed;

        var plus = version.IndexOf('+', StringComparison.Ordinal);
        if (plus > 0 && SemanticVersion.TryParse(version[..plus], out var noMeta))
            return noMeta;

        return null;
    }

    private static string ReadInformationalVersionFromEntryAssembly()
    {
        var asm = Assembly.GetEntryAssembly();
        var attr = asm?.GetCustomAttribute<AssemblyInformationalVersionAttribute>();
        if (!string.IsNullOrWhiteSpace(attr?.InformationalVersion))
            return attr.InformationalVersion;

        return asm?.GetName().Version?.ToString() ?? "0.0.0";
    }

    /// <summary>
    /// Supplies a resolved update for tests without an installed Velopack layout.
    /// </summary>
    internal void SetPendingUpdateForTests(Velopack.UpdateInfo? update) => _pendingVelopackUpdate = update;

    public async Task<Result> DownloadUpdatesAsync(AppUpdateInfo update, IProgress<int>? progress, CancellationToken cancellationToken = default)
    {
        if (_pendingVelopackUpdate == null)
            return Result.Failure("In-app download is only available for a Velopack-installed build.");

        var asset = _pendingVelopackUpdate.TargetFullRelease;
        if (!string.Equals(asset.Version.ToString(), update.Version, StringComparison.OrdinalIgnoreCase))
            return Result.Failure("Download requested for a different version than the pending Velopack update.");

        try
        {
            // The manager that produced the pending update, never a fresh one: rebuilding
            // it is how a channel switch invalidates the offer, so reaching for it again
            // here would download an asset the current channel does not publish.
            var um = GetLocalUpdateManager();
            void OnProgress(int p) => progress?.Report(p);
            await um.DownloadUpdatesAsync(_pendingVelopackUpdate, OnProgress, cancellationToken).ConfigureAwait(false);
            return Result.Success();
        }
        catch (Exception ex)
        {
            _logger.Error("Updates", "DownloadUpdatesAsync (Velopack) failed.", ex);
            return Result.Failure(ex.Message, ex);
        }
    }

    public void ApplyUpdatesAndRestart()
    {
        if (_pendingVelopackUpdate == null)
        {
            _logger.Warning("Updates", "ApplyUpdatesAndRestart called with no pending Velopack update.");
            return;
        }

        try
        {
            var um = GetLocalUpdateManager();
            um.ApplyUpdatesAndRestart(_pendingVelopackUpdate.TargetFullRelease, restartArgs: Array.Empty<string>());
        }
        catch (Exception ex)
        {
            _logger.Error("Updates", "ApplyUpdatesAndRestart failed.", ex);
        }
    }
}
