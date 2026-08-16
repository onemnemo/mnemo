using Mnemo.Core.Services;
using Mnemo.Host.Assets;
using Mnemo.Host.Lifecycle;
using Mnemo.Infrastructure.Common;

namespace Mnemo.Host.Notes;

/// <summary>
/// The notes module's assembled asset machinery: the managed store for uploaded images, the
/// registry of editing sessions whose undo history can still resurrect one, and the sweeper
/// that collects orphans against both. One object in DI so the endpoints, the delete route
/// and startup all reach the same instances.
/// </summary>
public sealed class NoteAssets
{
    public NoteAssets(IStorageProvider storage, INoteSidMigrator migrator, ILoggerService logger, HostInstanceLock instanceLock)
    {
        Store = new ManagedAssetStore(MnemoAppPaths.GetNoteAssetsDirectory, ManagedAssetStore.ImageExtensions);
        Sessions = new AssetSessionRegistry();
        Sweeper = new AssetSweeper(
            Store,
            [new NoteAssetReferenceSource(storage, migrator)],
            Sessions,
            logger,
            // Another running instance has its own editor sessions this process cannot see;
            // its undo history could still redo an image this sweep would call an orphan.
            standDown: () => instanceLock.AnotherInstanceIsRunning() ? "another app instance is running" : null);
    }

    public ManagedAssetStore Store { get; }
    public AssetSessionRegistry Sessions { get; }
    public AssetSweeper Sweeper { get; }
}
