using Mnemo.Host.Trash;
using Mnemo.Infrastructure.Services.Mindmap;

namespace Mnemo.Host.Mindmap;

/// <summary>
/// Answers for the mindmap image directory when the trash asks whether a file queued by a permanent
/// deletion can go.
/// </summary>
/// <remarks>
/// The question is not whether the destroyed map named the file, which is why it was queued, but
/// whether anything else still does. Two maps can point at the same image, and a map sitting in the
/// trash counts, so the check runs over every map the store owns rather than the library listing.
/// </remarks>
public sealed class MindmapAssetCleanupOwner : IAssetCleanupOwner
{
    private readonly MindmapAssets _assets;

    public MindmapAssetCleanupOwner(MindmapAssets assets)
    {
        _assets = assets;
    }

    /// <inheritdoc />
    public string Owner => MindmapAssetReferences.AssetOwner;

    /// <inheritdoc />
    public bool IsReady => _assets.References.IsReady;

    /// <inheritdoc />
    public async Task<AssetCleanupOutcome> DeleteIfUnreferencedAsync(string path, CancellationToken cancellationToken = default)
    {
        var assetId = MindmapAssetReferences.Parse(path);
        if (assetId is null)
            return AssetCleanupOutcome.Missing;

        // A corpus that cannot be read throws rather than reporting nothing referenced, so a failure
        // here keeps the job queued instead of deleting a file some map still shows.
        var referenced = await _assets.References.CollectReferencedIdsAsync(cancellationToken).ConfigureAwait(false);
        if (referenced.Contains(assetId))
            return AssetCleanupOutcome.StillReferenced;

        var file = _assets.Store.ResolvePath(assetId);
        if (file is null || !File.Exists(file))
            return AssetCleanupOutcome.Missing;

        File.Delete(file);
        return AssetCleanupOutcome.Deleted;
    }
}
