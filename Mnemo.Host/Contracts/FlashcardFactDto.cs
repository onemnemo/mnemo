using Mnemo.Core.Models.Flashcards;

namespace Mnemo.Host.Contracts;

/// <summary>
/// One named slot on a card type. Hand-mirrored in <c>mnemo-web/src/api/types.ts</c>; the C# side
/// is authoritative.
/// </summary>
public sealed record CardTypeFieldDto(string Id, string Name, string? Hint)
{
    public static CardTypeFieldDto FromModel(FlashcardField model) => new(model.Id, model.Name, model.Hint);

    public FlashcardField ToModel() => new(Id?.Trim() ?? string.Empty, Name?.Trim() ?? string.Empty, Blank(Hint));

    internal static string? Blank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}

/// <summary>One recipe for turning material into a card.</summary>
public sealed record CardTypeLayoutDto(string Id, string Name, string Front, string Back, string? Requires)
{
    public static CardTypeLayoutDto FromModel(FlashcardLayout model) =>
        new(model.Id, model.Name, model.Front, model.Back, model.Requires);

    public FlashcardLayout ToModel() => new(
        Id?.Trim() ?? string.Empty,
        Name?.Trim() ?? string.Empty,
        Front ?? string.Empty,
        Back ?? string.Empty,
        CardTypeFieldDto.Blank(Requires));
}

/// <summary>
/// What fields exist and which layouts to build from them. <c>IsBuiltIn</c> and the generator are
/// reported but never taken from a client: a built in type cannot stop being one, and changing a
/// generator would change how many cards every existing fact makes.
/// </summary>
public sealed record CardTypeDto(
    string Id,
    string Name,
    bool IsBuiltIn,
    IReadOnlyList<CardTypeFieldDto> Fields,
    string SortFieldId,
    IReadOnlyList<CardTypeLayoutDto> Layouts,
    string? Generator,
    string? GenerateFrom,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt)
{
    public static CardTypeDto FromModel(FlashcardCardType model) => new(
        model.Id,
        model.Name,
        model.IsBuiltIn,
        model.Fields.Select(CardTypeFieldDto.FromModel).ToList(),
        model.SortFieldId,
        model.Layouts.Select(CardTypeLayoutDto.FromModel).ToList(),
        model.Generator,
        model.GenerateFrom,
        model.CreatedAt,
        model.UpdatedAt);
}

/// <summary>
/// Card type save body. Full replace rather than a patch, for the same reason card edits are: with
/// JSON alone an absent list and an empty one are indistinguishable, so a patch could never remove
/// the last layout.
/// </summary>
public sealed record SaveCardTypeDto(
    string? Id,
    string Name,
    IReadOnlyList<CardTypeFieldDto>? Fields,
    string? SortFieldId,
    IReadOnlyList<CardTypeLayoutDto>? Layouts);

/// <summary>
/// A card type with the count of material using it, which is what the manager needs to say whether
/// deleting it is possible and what an edit is about to reach.
/// </summary>
public sealed record CardTypeSummaryDto(CardTypeDto Type, int FactCount);

/// <summary>
/// What a proposed card type save would take out of the collection, so the editor can name the
/// number before it asks.
/// </summary>
/// <param name="RemovedCardCount">Cards the save would move to the trash.</param>
/// <param name="AffectedFactCount">Pieces of material that would lose at least one card.</param>
public sealed record CardTypePreflightDto(int RemovedCardCount, int AffectedFactCount)
{
    /// <summary>Maps one preflight.</summary>
    public static CardTypePreflightDto FromModel(FlashcardCardTypePreflight model) =>
        new(model.RemovedCardCount, model.AffectedFactCount);
}

/// <summary>
/// The attachments on one field of a fact. Keyed by field rather than by card side, so a reversed
/// card carries the right pictures without anything having to know the reversal exists.
/// </summary>
public sealed record FactMediaDto(string FieldId, IReadOnlyList<CardAttachmentDto> Attachments);

/// <summary>One filling in of a card type's fields, and the material its cards render.</summary>
public sealed record FactDto(
    string Id,
    string DeckId,
    string TypeId,
    IReadOnlyDictionary<string, string> Values,
    IReadOnlyList<FactMediaDto> Media,
    IReadOnlyList<string> Tags,
    bool IsFlagged,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt)
{
    public static FactDto FromModel(FlashcardFact model) => new(
        model.Id,
        model.DeckId,
        model.TypeId,
        model.Values.ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.Ordinal),
        model.Media
            .Select(pair => new FactMediaDto(pair.Key, pair.Value.Select(CardAttachmentDto.FromModel).ToList()))
            .ToList(),
        model.Tags,
        model.IsFlagged,
        model.CreatedAt,
        model.UpdatedAt);
}

/// <summary>The attachments the editor sends back for one field.</summary>
public sealed record FactMediaInputDto(string FieldId, IReadOnlyList<CardAttachmentInputDto>? Attachments);

/// <summary>
/// Fact save body. A null <see cref="Id"/> creates; naming an existing fact replaces its content.
/// The server decides which cards that makes.
/// </summary>
public sealed record SaveFactDto(
    string? Id,
    string DeckId,
    string TypeId,
    IReadOnlyDictionary<string, string>? Values,
    IReadOnlyList<FactMediaInputDto>? Media,
    IReadOnlyList<string>? Tags);

/// <summary>
/// What a save did: the stored material, the cards it now has, and how the count moved. The client
/// renders "this made one more card" from the deltas rather than diffing the list itself.
/// </summary>
public sealed record FactSavedDto(
    FactDto Fact,
    IReadOnlyList<CardDto> Cards,
    int Added,
    int Removed)
{
    public static FactSavedDto FromModel(FlashcardFactSaved model) => new(
        FactDto.FromModel(model.Fact),
        model.Cards.Select(CardDto.FromModel).ToList(),
        model.Added,
        model.Removed);
}

/// <summary>Batch body for operations that only name material, such as delete.</summary>
public sealed record FactIdsDto(IReadOnlyList<string>? FactIds);
