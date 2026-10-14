using Mnemo.Core.Services;
using Mnemo.Host.Assets;
using Mnemo.Host.Lifecycle;
using Mnemo.Infrastructure.Common;
using Mnemo.Infrastructure.Services;

namespace Mnemo.Host.Notes;

public sealed class NoteAssets
{
    public NoteAssets(IStorageProvider storage, INoteSidMigrator migrator, ImageFileLocks locks, ILoggerService logger, HostInstanceLock instanceLock)
    {
        Store = new ManagedAssetStore(MnemoAppPaths.GetNoteAssetsDirectory, ManagedAssetStore.ImageExtensions);
        Sessions = new AssetSessionRegistry();
        References = new NoteAssetReferenceSource(storage, migrator);
        Sweeper = new AssetSweeper(
            Store,
            [References],
            Sessions,
            locks,
            logger,
            // Another running instance has its own editor sessions this process cannot see;
            // its undo history could still redo an image this sweep would call an orphan.
            standDown: () => instanceLock.AnotherInstanceIsRunning() ? "another app instance is running" : null);
    }

    public ManagedAssetStore Store { get; }
    public AssetSessionRegistry Sessions { get; }

    public NoteAssetReferenceSource References { get; }

    public AssetSweeper Sweeper { get; }
}
