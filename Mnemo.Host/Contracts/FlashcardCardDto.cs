using Mnemo.Core.Models.Flashcards;

namespace Mnemo.Host.Contracts;

/// <summary>
/// An image attached to one side of a card. Hand-mirrored in
/// <c>mnemo-web/src/api/types.ts</c>; the C# side is authoritative.
/// </summary>
/// <remarks>
/// The stored <see cref="FlashcardAttachment.FilePath"/> is an absolute local path and is
/// deliberately left off the wire: a browser cannot render it, and a client that could name
/// file paths would get to choose which files a future asset route serves. Attachments are
/// addressed by id.
/// </remarks>
public sealed record CardAttachmentDto(
    string Id,
    string Side,
    string DisplayName,
    long SizeBytes,
    string? Caption)
{
    public static CardAttachmentDto FromModel(FlashcardAttachment model)
        => new(model.Id, model.Side, model.DisplayName, model.SizeBytes, model.Caption);
}

/// <summary>
/// A card's content. Hand-mirrored in <c>mnemo-web/src/api/types.ts</c>; the C# side is
/// authoritative.
/// </summary>
public sealed record CardDto(
    string Id,
    string DeckId,
    string Type,
    string Front,
    string Back,
    IReadOnlyList<string> Tags,
    string State,
    bool IsFlagged,
    IReadOnlyList<CardAttachmentDto> Attachments,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt)
{
    public static CardDto FromModel(Flashcard model)
        => new(
            model.Id,
            model.DeckId,
            FlashcardWire.Type(model.Type),
            model.Front,
            model.Back,
            model.Tags,
            FlashcardWire.CardState(model.State),
            model.IsFlagged,
            model.Attachments.Select(CardAttachmentDto.FromModel).ToList(),
            model.CreatedAt,
            model.UpdatedAt);
}

/// <summary>
/// A card's FSRS schedule. The card id is omitted - it is always the enclosing card's.
/// Hand-mirrored in <c>mnemo-web/src/api/types.ts</c>; the C# side is authoritative.
/// </summary>
public sealed record CardScheduleDto(
    DateTimeOffset DueDate,
    double? Stability,
    double? Difficulty,
    int Reps,
    int Lapses,
    string FsrsState,
    int LearningStepIndex,
    DateTimeOffset? LastReviewedAt)
{
    public static CardScheduleDto FromModel(FlashcardSchedule model)
        => new(
            model.DueDate,
            model.Stability,
            model.Difficulty,
            model.Reps,
            model.Lapses,
            FlashcardWire.FsrsState(model.FsrsState),
            model.LearningStepIndex,
            model.LastReviewedAt);
}

/// <summary>A card paired with its schedule, as the deck table renders it.</summary>
public sealed record CardViewDto(CardDto Card, CardScheduleDto Schedule)
{
    public static CardViewDto FromModel(FlashcardView model)
        => new(CardDto.FromModel(model.Card), CardScheduleDto.FromModel(model.Schedule));
}

/// <summary>
/// One page of cards plus the total row count for the query. <c>Offset</c> and <c>Limit</c>
/// are the effective values the server used, not the raw request, so a client can render its
/// range label straight from them.
/// </summary>
public sealed record CardPageDto(
    IReadOnlyList<CardViewDto> Items,
    int TotalCount,
    int Offset,
    int Limit)
{
    public static CardPageDto FromModel(FlashcardCardPage model)
        => new(model.Items.Select(CardViewDto.FromModel).ToList(), model.TotalCount, model.Offset, model.Limit);
}

/// <summary>
/// Card create body. The server assigns the id, timestamps and the initial (New, due now)
/// schedule, and always creates the card active and unflagged.
/// </summary>
public sealed record CreateCardDto(string Type, string Front, string Back, IReadOnlyList<string>? Tags);

/// <summary>
/// Full replace of the editable content fields rather than a patch: with JSON alone an absent
/// field and an explicit null are indistinguishable, so a patch shape could never clear the
/// tag list. Suspended/flagged state and attachments are not editable here - they have their
/// own routes - and are carried over from the stored card.
/// </summary>
public sealed record UpdateCardDto(string Type, string Front, string Back, IReadOnlyList<string>? Tags);

/// <summary>Batch body for operations that only need to name cards, such as delete.</summary>
public sealed record CardIdsDto(IReadOnlyList<string>? CardIds);

/// <summary>Batch body for moving cards into another deck.</summary>
public sealed record MoveCardsDto(IReadOnlyList<string>? CardIds, string TargetDeckId);

/// <summary>Batch body for the two boolean card flags: suspended and flagged.</summary>
public sealed record CardToggleDto(IReadOnlyList<string>? CardIds, bool Value);

/// <summary>Batch body for adding one tag to many cards.</summary>
public sealed record AddCardTagDto(IReadOnlyList<string>? CardIds, string Tag);
