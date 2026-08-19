using Mnemo.Core.Services;
using Mnemo.Host.Trash;
using Mnemo.Infrastructure.Common;
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
    private readonly IImageAssetService _images;
    private readonly ILoggerService? _logger;

    public FlashcardAssetCleanupOwner(IFlashcardStore store, IImageAssetService images, ILoggerService? logger = null)
    {
        _store = store;
        _images = images;
        _logger = logger;
    }

    /// <inheritdoc />
    public string Owner => FlashcardAssetReferences.AssetOwner;

    /// <inheritdoc />
    public bool IsReady => true;

    /// <inheritdoc />
    public async Task<AssetCleanupOutcome> DeleteIfUnreferencedAsync(string path, CancellationToken cancellationToken = default)
    {
        // An imported card can name a picture the user keeps somewhere else on disk. That file is
        // never ours to remove, so it is reported as nothing to do rather than retried forever.
        if (string.IsNullOrWhiteSpace(path) || !MnemoAppPaths.IsPathUnderImagesDirectory(path))
            return AssetCleanupOutcome.Missing;

        // A collection that cannot be read throws rather than reporting nothing referenced, so a
        // failure here keeps the job queued instead of taking a file some card still shows.
        var referenced = await FlashcardAssetReferences
            .CollectReferencedPathsAsync(_store, _logger, cancellationToken)
            .ConfigureAwait(false);

        if (FlashcardAssetReferences.Contains(referenced, path))
            return AssetCleanupOutcome.StillReferenced;

        if (!File.Exists(path))
            return AssetCleanupOutcome.Missing;

        var result = await _images.DeleteStoredFileAsync(path, cancellationToken).ConfigureAwait(false);
        if (!result.IsSuccess)
            throw new IOException(result.ErrorMessage ?? $"The image at {path} could not be deleted.", result.Exception);

        return AssetCleanupOutcome.Deleted;
    }
}
