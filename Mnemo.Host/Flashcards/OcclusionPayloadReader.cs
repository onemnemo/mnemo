using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Services;
using Mnemo.Host.Contracts;

namespace Mnemo.Host.Flashcards;

/// <summary>Builds the occlusion payload for cards served one at a time. Caches facts, so make one per request.</summary>
public sealed class OcclusionPayloadReader
{
    private readonly IFlashcardFactService _facts;
    private readonly Dictionary<string, FlashcardFact?> _cache = new(StringComparer.Ordinal);

    public OcclusionPayloadReader(IFlashcardFactService facts) => _facts = facts;

    /// <summary>The payload for an occlusion card, or null for any other card or one whose fact, image or mask is gone.</summary>
    public async Task<OcclusionDto?> ReadAsync(Flashcard card, CancellationToken cancellationToken)
    {
        if (card.Type != FlashcardType.Occlusion || card.FactId is null || card.LayoutKey is null)
            return null;

        if (!_cache.TryGetValue(card.FactId, out var fact))
        {
            fact = await _facts.GetFactAsync(card.FactId, cancellationToken).ConfigureAwait(false);
            _cache[card.FactId] = fact;
        }

        return fact is null ? null : Build(fact, card.LayoutKey);
    }

    /// <summary>The payload for the card with this key, or null when the fact no longer makes it.</summary>
    public static OcclusionDto? Build(FlashcardFact fact, string layoutKey)
    {
        var image = fact.MediaOn(FlashcardCardType.OcclusionImageFieldId).FirstOrDefault();
        if (image is null)
            return null;

        var document = FlashcardOcclusion.Parse(fact.Value(FlashcardCardType.OcclusionMasksFieldId));
        var unit = FlashcardOcclusionUnits.Build(document).Units
            .FirstOrDefault(u => string.Equals(u.Key, layoutKey, StringComparison.Ordinal));
        if (unit is null)
            return null;

        return new OcclusionDto(
            document.Mode,
            document.Masks.OrderBy(m => m.Order).ThenBy(m => m.Id, StringComparer.Ordinal)
                .Select(OcclusionMaskDto.FromModel).ToList(),
            unit.Members.Select(m => m.Id).ToList(),
            fact.Value(FlashcardCardType.OcclusionBackFieldId).Trim(),
            FlashcardAssetStore.AssetIdForPath(image.FilePath));
    }
}
