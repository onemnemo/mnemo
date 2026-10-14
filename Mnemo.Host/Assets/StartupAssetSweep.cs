using Microsoft.AspNetCore.Http;
using Mnemo.Core.Services;
using Mnemo.Host.Flashcards;
using Mnemo.Host.Lifecycle;
using Mnemo.Host.Mindmap;
using Mnemo.Host.Notes;
using Mnemo.Infrastructure.Services;
using Mnemo.Infrastructure.Services.Flashcards.Persistence;

namespace Mnemo.Host.Assets;

/// <summary>Writes are held until the startup read finishes, so undo cannot bring back a deleted file.</summary>
public sealed class StartupAssetSweep
{
    private static readonly string[] UngatedPrefixes = ["/api/app", "/api/proofing", "/api/dev"];

    private readonly TaskCompletionSource _referencesRead = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly IReadOnlyList<Sweep> _sweeps;
    private readonly Func<string?> _standDown;
    private readonly ILoggerService _logger;
    private readonly TimeSpan _readTimeout;

    public StartupAssetSweep(
        SharedImageStore images,
        ImageFileLocks locks,
        NoteAssets notes,
        MindmapAssets maps,
        IFlashcardStore flashcards,
        ILoggerService logger,
        HostInstanceLock instanceLock)
        : this(
            NewSweeps(images, notes, maps, flashcards),
            locks,
            // Another instance has undo history this process cannot see.
            () => instanceLock.AnotherInstanceIsRunning() ? "another app instance is running" : null,
            logger,
            TimeSpan.FromSeconds(30))
    {
    }

    internal StartupAssetSweep(
        IReadOnlyList<(ManagedAssetStore Store, IAssetReferenceSource[] Sources)> sweeps,
        ImageFileLocks locks,
        Func<string?> standDown,
        ILoggerService logger,
        TimeSpan readTimeout)
    {
        _standDown = standDown;
        _logger = logger;
        _readTimeout = readTimeout;
        _sweeps = sweeps
            .Select(sweep => new Sweep(sweep.Store, sweep.Sources,
                new AssetSweeper(sweep.Store, sweep.Sources, new AssetSessionRegistry(), locks, logger, standDown: standDown)))
            .ToList();
    }

    public Task ReferencesRead => _referencesRead.Task;

    public static bool IsGated(HttpRequest request) =>
        !HttpMethods.IsGet(request.Method)
        && !HttpMethods.IsHead(request.Method)
        && !HttpMethods.IsOptions(request.Method)
        && request.Path.StartsWithSegments("/api")
        && !UngatedPrefixes.Any(prefix => request.Path.StartsWithSegments(prefix));

    public async Task GateAsync(HttpContext context, RequestDelegate next)
    {
        if (IsGated(context.Request))
            await ReferencesRead.WaitAsync(context.RequestAborted).ConfigureAwait(false);
        await next(context).ConfigureAwait(false);
    }

    public void RunInBackground() => _ = Task.Run(RunAsync);

    internal async Task RunAsync()
    {
        List<Sweep> due;
        try
        {
            due = _sweeps.Where(sweep => HasFiles(sweep.Store.Directory)).ToList();
            var sources = due.SelectMany(sweep => sweep.Sources).Distinct().ToList();
            if (due.Count == 0 || _standDown() is not null || !sources.All(source => source.IsReady))
                return;

            var read = Task.WhenAll(sources.Select(source => source.CollectReferencedIdsAsync()));
            if (await Task.WhenAny(read, Task.Delay(_readTimeout)).ConfigureAwait(false) != read)
            {
                _logger.Warning("Mnemo.Host", $"Reading image references took over {_readTimeout.TotalSeconds:0} s, so the startup sweep was skipped.");
                return;
            }
            await read.ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            _logger.Error("Mnemo.Host", "Reading image references for the startup sweep failed.", ex);
            return;
        }
        finally
        {
            _referencesRead.TrySetResult();
        }

        foreach (var sweep in due)
        {
            try
            {
                await sweep.Sweeper.SweepAsync().ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                _logger.Error("Mnemo.Host", $"Asset sweep of '{sweep.Store.Directory}' failed.", ex);
            }
        }
    }

    private static List<(ManagedAssetStore, IAssetReferenceSource[])> NewSweeps(
        SharedImageStore images, NoteAssets notes, MindmapAssets maps, IFlashcardStore flashcards)
    {
        var mapReferences = new ReadOnce(maps.References);
        return
        [
            (maps.Store, [mapReferences]),
            (new ManagedAssetStore(() => images.Directory, ManagedAssetStore.ImageExtensions),
                [new ReadOnce(notes.References), mapReferences, new ReadOnce(new FlashcardAssetReferenceSource(flashcards))]),
        ];
    }

    private static bool HasFiles(string directory) =>
        Directory.Exists(directory) && Directory.EnumerateFiles(directory).Any();

    private sealed record Sweep(ManagedAssetStore Store, IAssetReferenceSource[] Sources, AssetSweeper Sweeper);

    private sealed class ReadOnce(IAssetReferenceSource source) : IAssetReferenceSource
    {
        private Task<IReadOnlyCollection<string>>? _read;

        public bool IsReady => source.IsReady;

        public Task<IReadOnlyCollection<string>> CollectReferencedIdsAsync(CancellationToken cancellationToken = default) =>
            _read ??= source.CollectReferencedIdsAsync(cancellationToken);
    }
}
