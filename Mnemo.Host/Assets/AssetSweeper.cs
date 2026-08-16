using Mnemo.Core.Services;

namespace Mnemo.Host.Assets;

/// <summary>What one sweep did, or why it declined to run.</summary>
public sealed record AssetSweepResult(bool Swept, string? SkipReason, int Scanned, int Deleted)
{
    public static AssetSweepResult Skipped(string reason) => new(false, reason, 0, 0);
}

/// <summary>
/// Mark-and-sweep garbage collection for one managed asset directory.
/// </summary>
/// <remarks>
/// A file survives when any reference source still names it, when an editing session is open
/// (its undo history may reference files no saved document does), or when the file is younger
/// than the grace window (an upload exists on disk before the document referencing it is
/// saved). Everything else is an orphan: an upload whose insert was undone and navigated away
/// from, a crash before cleanup could run, a deleted note's images.
///
/// Sweeps therefore run where those conditions naturally hold: at startup, when no session
/// can exist yet, and when a session closes, right after its undo history is discarded. The
/// registry is re-checked before every deletion, so a session that opens mid-sweep aborts the
/// remaining deletes rather than racing the new editor's history.
/// </remarks>
public sealed class AssetSweeper
{
    /// <summary>
    /// How long an unreferenced file is presumed to be an upload still in flight. Autosave's
    /// ceiling is seconds, so an hour covers every save race with two orders of magnitude to
    /// spare; a true orphan just waits for a later sweep.
    /// </summary>
    public static readonly TimeSpan DefaultGrace = TimeSpan.FromHours(1);

    private readonly ManagedAssetStore _store;
    private readonly IReadOnlyList<IAssetReferenceSource> _sources;
    private readonly AssetSessionRegistry _sessions;
    private readonly ILoggerService _logger;
    private readonly TimeSpan _grace;
    private readonly Func<DateTime> _utcNow;
    private readonly Func<string?> _standDown;
    private readonly SemaphoreSlim _running = new(1, 1);

    /// <param name="standDown">
    /// An extra hold beyond the session registry, returning the reason to stand down or null
    /// to proceed. Notes use it to defer while another app instance is running, whose own
    /// sessions this process cannot see. Probed again before every deletion, like the registry.
    /// </param>
    public AssetSweeper(
        ManagedAssetStore store,
        IReadOnlyList<IAssetReferenceSource> sources,
        AssetSessionRegistry sessions,
        ILoggerService logger,
        TimeSpan? grace = null,
        Func<DateTime>? utcNow = null,
        Func<string?>? standDown = null)
    {
        _store = store;
        _sources = sources;
        _sessions = sessions;
        _logger = logger;
        _grace = grace ?? DefaultGrace;
        _utcNow = utcNow ?? (() => DateTime.UtcNow);
        _standDown = standDown ?? (() => null);
    }

    /// <summary>
    /// Fire-and-forget wrapper for the call sites that must not wait on a sweep: a session
    /// close response, a note deletion, startup. Failures are logged, never thrown.
    /// </summary>
    public void SweepInBackground()
    {
        _ = Task.Run(async () =>
        {
            try
            {
                await SweepAsync().ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                _logger.Error("Mnemo.Host", $"Asset sweep of '{_store.Directory}' failed.", ex);
            }
        });
    }

    public async Task<AssetSweepResult> SweepAsync(CancellationToken cancellationToken = default)
    {
        foreach (var source in _sources)
        {
            if (!source.IsReady)
                return AssetSweepResult.Skipped("a reference source is not ready");
        }
        if (_sessions.ActiveCount > 0)
            return AssetSweepResult.Skipped("an editing session is open");
        if (_standDown() is { } held)
            return AssetSweepResult.Skipped(held);
        // A second concurrent sweep would double-delete the same scan; the one already
        // running covers it.
        if (!await _running.WaitAsync(0, cancellationToken).ConfigureAwait(false))
            return AssetSweepResult.Skipped("a sweep is already running");

        try
        {
            return await SweepLockedAsync(cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            _running.Release();
        }
    }

    private async Task<AssetSweepResult> SweepLockedAsync(CancellationToken cancellationToken)
    {
        var directory = _store.Directory;
        if (!Directory.Exists(directory))
            return new AssetSweepResult(true, null, 0, 0);

        var files = Directory.GetFiles(directory);
        var referenced = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var source in _sources)
        {
            foreach (var id in await source.CollectReferencedIdsAsync(cancellationToken).ConfigureAwait(false))
                referenced.Add(id);
        }

        var cutoff = _utcNow() - _grace;
        var deleted = 0;

        foreach (var path in files)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var name = Path.GetFileName(path);

            var pendingUpload = name.EndsWith(ManagedAssetStore.PendingUploadSuffix, StringComparison.OrdinalIgnoreCase);
            // Only shapes this store mints are ours to delete; anything else (an OS metadata
            // file, a hand-placed file) is left alone.
            if (!pendingUpload && !_store.IsValidAssetId(name))
                continue;
            if (!pendingUpload
                && (referenced.Contains(name) || referenced.Contains(Path.GetFileNameWithoutExtension(name))))
                continue;
            if (LastTouchedUtc(path) > cutoff)
                continue;
            // An editor opened mid-sweep: its history can reference files the saved corpus no
            // longer does, and the corpus was read before it opened. Stop deleting; the
            // session's own close triggers the next sweep. The external hold gets the same
            // re-check for the same reason.
            if (_sessions.ActiveCount > 0)
                return new AssetSweepResult(true, "aborted: an editing session opened mid-sweep", files.Length, deleted);
            if (_standDown() is { } heldMidSweep)
                return new AssetSweepResult(true, $"aborted: {heldMidSweep}", files.Length, deleted);

            if (TryDelete(path))
                deleted++;
        }

        if (deleted > 0)
            _logger.Info("Mnemo.Host", $"Asset sweep removed {deleted} orphaned file(s) from '{directory}'.");
        return new AssetSweepResult(true, null, files.Length, deleted);
    }

    /// <summary>
    /// The later of creation and last write. A copy can carry an old write time into a young
    /// file, and some tools preserve creation time; taking the maximum errs toward keeping.
    /// </summary>
    private static DateTime LastTouchedUtc(string path)
    {
        var created = File.GetCreationTimeUtc(path);
        var written = File.GetLastWriteTimeUtc(path);
        return created > written ? created : written;
    }

    private bool TryDelete(string path)
    {
        try
        {
            File.Delete(path);
            return true;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            _logger.Warning("Mnemo.Host", $"Asset sweep could not delete '{path}': {ex.Message}");
            return false;
        }
    }
}
