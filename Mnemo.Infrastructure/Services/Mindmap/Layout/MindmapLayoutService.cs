using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Mindmap;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Services.Mindmap.Layout;

/// <summary>
/// Dispatches a <see cref="LayoutSnapshot"/> to the registered <see cref="IMindmapLayoutProvider"/> for its
/// algorithm. The provider is a pure function, so it runs on the thread pool and cancels with the
/// token; an unknown algorithm id falls back to <see cref="MindmapLayoutAlgorithms.Balanced"/> with a warning.
/// </summary>
public sealed class MindmapLayoutService : IMindmapLayoutService
{
    private readonly IReadOnlyDictionary<string, IMindmapLayoutProvider> _providers;
    private readonly ILoggerService _logger;

    public MindmapLayoutService(IEnumerable<IMindmapLayoutProvider> providers, ILoggerService logger)
    {
        // Later registration wins so a plugin can override a built-in id.
        var map = new Dictionary<string, IMindmapLayoutProvider>(StringComparer.Ordinal);
        foreach (var provider in providers)
            map[provider.Id] = provider;
        _providers = map;
        _logger = logger;
    }

    public async Task<Result<LayoutResult>> ComputeAsync(LayoutSnapshot snapshot, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(snapshot);

        try
        {
            var result = await Task.Run(() =>
            {
                cancellationToken.ThrowIfCancellationRequested();
                var provider = ResolveProvider(snapshot.Algorithm);
                var positions = provider.Compute(snapshot);
                cancellationToken.ThrowIfCancellationRequested();
                return new LayoutResult { Positions = positions, Revision = snapshot.Revision };
            }, cancellationToken).ConfigureAwait(false);

            return Result<LayoutResult>.Success(result);
        }
        catch (OperationCanceledException)
        {
            throw; // A newer edit superseded this pass; the caller drops it.
        }
        catch (Exception ex)
        {
            _logger.Error("Mindmap", $"Layout '{snapshot.Algorithm}' failed for cluster '{snapshot.RootId}'.", ex);
            return Result<LayoutResult>.Failure("Layout computation failed.", ex);
        }
    }

    private IMindmapLayoutProvider ResolveProvider(string algorithm)
    {
        if (!string.IsNullOrEmpty(algorithm) && _providers.TryGetValue(algorithm, out var provider))
            return provider;

        _logger.Warning("Mindmap", $"Unknown layout algorithm '{algorithm}'; falling back to '{MindmapLayoutAlgorithms.Balanced}'.");
        if (_providers.TryGetValue(MindmapLayoutAlgorithms.Balanced, out var fallback))
            return fallback;

        // No balanced provider registered (a degenerate config); use any provider deterministically.
        return _providers.Values.OrderBy(p => p.Id, StringComparer.Ordinal).First();
    }
}
