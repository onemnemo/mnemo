using System;
using System.Collections.Generic;
using System.Linq;
using Mnemo.Core.Models.Flashcards;

namespace Mnemo.Infrastructure.Services.Flashcards.Generation;

/// <summary>
/// The material a card written side by side rather than through a card type stands for.
/// </summary>
/// <remarks>
/// <para>
/// An import and the older card routes still hand over a front and a back, but every card in the
/// collection belongs to some material now: that is what the editor opens, what siblings are found
/// through, and what a later edit regenerates from. A card arriving without any would be one
/// nobody could edit again, so one is made for it on the way in, by the same rules the upgrade uses
/// on a collection written before card types existed.
/// </para>
/// <para>
/// Only the card that was asked for is written. A cloze front holding three deletions produces the
/// material for all three but the one card the caller passed, keeping an imported card count equal
/// to the count in the package; saving that material later fills in the rest.
/// </para>
/// </remarks>
internal static class FlashcardCardMaterial
{
    /// <summary>
    /// The material for a card, and the card as it should be stored: bound to that material, and
    /// for a cloze card showing the one deletion it stands for rather than the raw markers.
    /// </summary>
    public static (FlashcardFact Fact, Flashcard Card) For(Flashcard card, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(card);

        var ordinals = card.Type == FlashcardType.Cloze
            ? FlashcardGeneration.ClozeOrdinals(card.Front)
            : [];
        // A cloze card with no marker in it would generate nothing, and losing a card to a
        // classification nobody typed is not an acceptable outcome of an import.
        var asCloze = ordinals.Count > 0;

        var (typeId, sourceFieldId, extraFieldId) = asCloze
            ? (FlashcardCardType.ClozeId, FlashcardCardType.ClozeTextFieldId, FlashcardCardType.ClozeExtraFieldId)
            : (FlashcardCardType.BasicId, FlashcardCardType.BasicFrontFieldId, FlashcardCardType.BasicBackFieldId);

        var fact = new FlashcardFact(
            Id: Guid.NewGuid().ToString("N"),
            DeckId: card.DeckId,
            TypeId: typeId,
            Values: new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [sourceFieldId] = card.Front,
                [extraFieldId] = card.Back,
            },
            Media: MediaByField(card.Attachments, sourceFieldId, extraFieldId),
            Tags: card.Tags,
            IsFlagged: card.IsFlagged,
            SourceInfo: card.SourceInfo,
            CreatedAt: card.CreatedAt == default ? now : card.CreatedAt,
            UpdatedAt: card.UpdatedAt == default ? now : card.UpdatedAt);

        if (!asCloze)
            return (fact, card with { FactId = fact.Id, LayoutKey = FlashcardCardType.RecognitionLayoutId });

        var lowest = ordinals[0];
        var extra = card.Back.Trim();
        return (fact, card with
        {
            FactId = fact.Id,
            LayoutKey = FlashcardGeneration.ClozeKey(lowest),
            Front = FlashcardGeneration.MaskCloze(card.Front, lowest, reveal: false),
            Back = JoinParagraphs(FlashcardGeneration.MaskCloze(card.Front, lowest, reveal: true), extra),
        });
    }

    /// <summary>
    /// Rekeys attachments from the side they were handed on to the field that now owns them, which
    /// is what lets a layout collect the right pictures without knowing which side it renders on.
    /// </summary>
    private static IReadOnlyDictionary<string, IReadOnlyList<FlashcardAttachment>> MediaByField(
        IReadOnlyList<FlashcardAttachment> attachments,
        string frontFieldId,
        string backFieldId)
    {
        var media = new Dictionary<string, IReadOnlyList<FlashcardAttachment>>(StringComparer.Ordinal);
        if (attachments.Count == 0)
            return media;

        var front = attachments.Where(a => !IsBack(a)).ToArray();
        var back = attachments.Where(IsBack).ToArray();
        if (front.Length > 0)
            media[frontFieldId] = front;
        if (back.Length > 0)
            media[backFieldId] = back;
        return media;
    }

    private static bool IsBack(FlashcardAttachment attachment) =>
        string.Equals(attachment.Side, FlashcardAttachment.BackSide, StringComparison.OrdinalIgnoreCase);

    private static string JoinParagraphs(params string[] parts) =>
        string.Join("\n\n", parts.Where(p => !string.IsNullOrEmpty(p)));
}
