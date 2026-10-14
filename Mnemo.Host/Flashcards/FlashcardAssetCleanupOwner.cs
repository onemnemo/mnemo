using Mnemo.Host.Lifecycle;
using Mnemo.Host.Trash;
using Mnemo.Infrastructure.Common;
using Mnemo.Infrastructure.Services;
using Mnemo.Infrastructure.Services.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards.Persistence;

namespace Mnemo.Host.Flashcards;

/// <summary>
/// Answers for flashcard attachments when the trash asks whether a file queued by a permanent
/// deletion can go.
/// </summary>
/// <remarks>
/// A card made from material carries the very same file its material stored the picture under, and
/// every other card that material makes carries it too, so the file only goes once nothing at all
/// names it. Cards and material the trash is holding count as something naming it: dropping a file
/// while a card sat in the trash would bring the card back as a broken image.
/// </remarks>
public sealed class FlashcardAssetCleanupOwner : IAssetCleanupOwner
{
    private readonly IFlashcardStore _store;
    private readonly ImageFileLocks _locks;
    private readonly HostInstanceLock _instanceLock;

    public FlashcardAssetCleanupOwner(IFlashcardStore store, ImageFileLocks locks, HostInstanceLock instanceLock)
    {
        _store = store;
        _locks = locks;
        _instanceLock = instanceLock;
    }

    /// <inheritdoc />
    public string Owner => FlashcardAssetReferences.AssetOwner;

    /// <inheritdoc />
    public bool IsReady => !_instanceLock.AnotherInstanceIsRunning();

    /// <inheritdoc />
    public async Task<AssetCleanupOutcome> DeleteIfUnreferencedAsync(string path, CancellationToken cancellationToken = default)
    {
        // Files elsewhere on disk are not ours, and shared files are left to the startup sweep.
        if (string.IsNullOrWhiteSpace(path) || !MnemoAppPaths.IsPathUnderImagesDirectory(path))
            return AssetCleanupOutcome.Missing;

        // A collection that cannot be read throws rather than reporting nothing referenced, so a
        // failure here keeps the job queued instead of taking a file some card still shows.
        var referenced = await FlashcardAssetReferences
            .CollectReferencedPathsAsync(_store, cancellationToken)
            .ConfigureAwait(false);

        if (FlashcardAssetReferences.Contains(referenced, path))
            return AssetCleanupOutcome.StillReferenced;

        if (await _locks.DeleteIfStaleAsync(path, ImageFileLocks.DefaultGrace, cancellationToken).ConfigureAwait(false))
            return AssetCleanupOutcome.Deleted;
        return File.Exists(path) ? AssetCleanupOutcome.Deferred : AssetCleanupOutcome.Missing;
    }
}
