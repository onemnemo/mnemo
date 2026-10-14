using Mnemo.Host.Trash;
using Mnemo.Infrastructure.Services.Mindmap;

namespace Mnemo.Host.Mindmap;

public sealed class MindmapAssetCleanupOwner : IAssetCleanupOwner
{
    /// <inheritdoc />
    public string Owner => MindmapAssetReferences.AssetOwner;

    /// <inheritdoc />
    public bool IsReady => true;

    /// <inheritdoc />
    public Task<AssetCleanupOutcome> DeleteIfUnreferencedAsync(string path, CancellationToken cancellationToken = default) =>
        Task.FromResult(AssetCleanupOutcome.Missing);
}
