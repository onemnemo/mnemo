using System.Collections.Generic;
using System.Linq;
using Mnemo.Core.Models.Flashcards;

namespace Mnemo.Infrastructure.Services.Flashcards.Generation;

/// <summary>
/// The cards an image occlusion fact makes, one per ungrouped mask and one per group. The web editor keeps a matching copy.
/// </summary>
internal static class FlashcardOcclusionGeneration
{
    /// <summary>Fields are read by fixed id, so an edited type makes no cards rather than throwing.</summary>
    public static IReadOnlyList<FlashcardGeneratedCard> Generate(FlashcardFact fact)
    {
        var image = fact.MediaOn(FlashcardCardType.OcclusionImageFieldId).FirstOrDefault();
        if (image is null)
            return [];

        var units = FlashcardOcclusionUnits.Build(
            FlashcardOcclusion.Parse(fact.Value(FlashcardCardType.OcclusionMasksFieldId))).Units;
        var front = fact.Value(FlashcardCardType.OcclusionFrontFieldId).Trim();

        return
        [
            .. units.Select(unit => new FlashcardGeneratedCard(
                Key: unit.Key,
                LayoutName: null,
                Front: front,
                Back: FlashcardOcclusionUnits.LabelOf(unit),
                FrontMedia: [image],
                BackMedia: []))
        ];
    }
}
