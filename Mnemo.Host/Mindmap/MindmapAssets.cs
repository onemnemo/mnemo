using Mnemo.Core.Services;
using Mnemo.Host.Assets;
using Mnemo.Host.Lifecycle;
using Mnemo.Infrastructure.Common;
using Mnemo.Infrastructure.Services.Mindmap.Persistence;

namespace Mnemo.Host.Mindmap;

/// <summary>
/// The mindmap module's assembled asset machinery: the managed store new canvas images are uploaded
/// into, a read-only view of the shared directory older maps point at, and the sweeper that collects
/// orphans from the module's own directory. One object in DI so the endpoints, the exporter and
/// startup all reach the same instances.
/// </summary>
/// <remarks>
/// <para>
/// Uploads used to land in the shared images directory, alongside flashcard images, note images and
/// everything the desktop app wrote. Nothing could be reclaimed there: every store mints the same
/// <c>{guid}{ext}</c> shape, so a file in it is indistinguishable from any other module's, and a pass
/// that deleted what mindmaps no longer reference would take other modules' images with it. An
/// image whose element was deleted therefore stayed on disk forever.
/// </para>
/// <para>
/// New uploads go to a directory this module owns, which is what makes the sweep safe rather than
/// merely careful, the same move notes made. Existing maps keep working because the shared directory
/// is still read; it is simply never written to and never swept, so an image a map has always
/// pointed at cannot be taken away by this.
/// </para>
/// <para>
/// The sweep runs at startup and nowhere else. A canvas image that was deleted can come back through
/// undo, and undo lives in the open client, so the only moment its history is known to be empty is
/// before a client has loaded.
/// </para>
/// </remarks>
public sealed class MindmapAssets
{
    public MindmapAssets(IMindmapTrashStore maps, ILoggerService logger, HostInstanceLock instanceLock)
    {
        References = new MindmapAssetReferenceSource(maps);
        Store = new ManagedAssetStore(MnemoAppPaths.GetMindmapAssetsDirectory, ManagedAssetStore.ImageExtensions);
        Legacy = new ManagedAssetStore(MnemoAppPaths.GetImagesDirectory, ManagedAssetStore.ImageExtensions);
        Sweeper = new AssetSweeper(
            Store,
            [References],
            new AssetSessionRegistry(),
            logger,
            // Another running instance has a client of its own this process cannot see, whose undo
            // history could still bring back an image this sweep would call an orphan.
            standDown: () => instanceLock.AnotherInstanceIsRunning() ? "another app instance is running" : null);
    }

    /// <summary>Every image a stored map still names, held maps included. Shared with cleanup.</summary>
    public MindmapAssetReferenceSource References { get; }

    /// <summary>Where new uploads go, and the only directory the sweep touches.</summary>
    public ManagedAssetStore Store { get; }

    /// <summary>The shared images directory, read for maps that predate the one above. Never written, never swept.</summary>
    public ManagedAssetStore Legacy { get; }

    public AssetSweeper Sweeper { get; }

    /// <summary>
    /// The file an asset id names, or null when nothing on disk answers to it. The module's own
    /// directory first, then the shared one, so a map made before the split still draws its images
    /// and a map made after it is never shadowed by a same-named file in the shared directory.
    /// </summary>
    public string? Locate(string? assetId)
    {
        var owned = Store.ResolvePath(assetId);
        if (owned is not null && File.Exists(owned))
            return owned;

        var legacy = Legacy.ResolvePath(assetId);
        return legacy is not null && File.Exists(legacy) ? legacy : null;
    }
}
