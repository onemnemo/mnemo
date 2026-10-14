using Mnemo.Host.Assets;
using Mnemo.Infrastructure.Common;
using Mnemo.Infrastructure.Services;
using Mnemo.Infrastructure.Services.Mindmap.Persistence;

namespace Mnemo.Host.Mindmap;

public sealed class MindmapAssets
{
    private readonly SharedImageStore _images;

    public MindmapAssets(IMindmapTrashStore maps, SharedImageStore images)
    {
        _images = images;
        References = new MindmapAssetReferenceSource(maps);
        Store = new ManagedAssetStore(MnemoAppPaths.GetMindmapAssetsDirectory, ManagedAssetStore.ImageExtensions);
        Legacy = new ManagedAssetStore(MnemoAppPaths.GetImagesDirectory, ManagedAssetStore.ImageExtensions);
    }

    public MindmapAssetReferenceSource References { get; }

    public ManagedAssetStore Store { get; }

    /// <summary>Read for older maps. Never written, never swept.</summary>
    public ManagedAssetStore Legacy { get; }

    public string? Locate(string? assetId)
    {
        if (_images.Locate(assetId) is { } shared)
            return shared;

        var owned = Store.ResolvePath(assetId);
        if (owned is not null && File.Exists(owned))
            return owned;

        var legacy = Legacy.ResolvePath(assetId);
        return legacy is not null && File.Exists(legacy) ? legacy : null;
    }
}
