using Mnemo.Host.Assets;
using Mnemo.Infrastructure.Services.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards.Persistence;

namespace Mnemo.Host.Flashcards;

/// <summary>Reports file names only, since rows store absolute paths. Includes images written into card text.</summary>
public sealed class FlashcardAssetReferenceSource : IAssetReferenceSource
{
    private readonly IFlashcardStore _store;

    public FlashcardAssetReferenceSource(IFlashcardStore store)
    {
        _store = store;
    }

    public bool IsReady => true;

    public async Task<IReadOnlyCollection<string>> CollectReferencedIdsAsync(CancellationToken cancellationToken = default)
    {
        var paths = await FlashcardAssetReferences.CollectReferencedPathsAsync(_store, cancellationToken).ConfigureAwait(false);
        var names = paths.Select(Path.GetFileName).OfType<string>().ToHashSet(StringComparer.OrdinalIgnoreCase);
        names.UnionWith(await FlashcardAssetReferences.CollectInlineImageNamesAsync(_store, cancellationToken).ConfigureAwait(false));
        return names;
    }
}
