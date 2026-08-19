namespace Mnemo.Core.Models.Flashcards;

/// <summary>
/// One filling in of a card type's fields, and the material every card made from it renders.
/// Editing a fact regenerates its cards; the cards themselves hold no authored content.
/// </summary>
/// <param name="DeckId">
/// Where cards newly generated from this fact are filed. An individual card can be moved
/// elsewhere afterwards and keeps its own deck, so this is the home rather than the whole truth.
/// </param>
/// <param name="TypeId">
/// The card type whose fields these values fill. A fact whose type has been deleted still lists,
/// falling back to the basic type rather than disappearing.
/// </param>
/// <param name="Values">Field id to authored text. A field with no entry is empty, not missing.</param>
/// <param name="Media">
/// Attachments keyed by field id rather than by card side. A layout collects the media of whatever
/// fields it references, so a reversed card carries the right pictures without anything in the
/// system knowing that reversal exists.
/// </param>
public sealed record FlashcardFact(
    string Id,
    string DeckId,
    string TypeId,
    IReadOnlyDictionary<string, string> Values,
    IReadOnlyDictionary<string, IReadOnlyList<FlashcardAttachment>> Media,
    IReadOnlyList<string> Tags,
    bool IsFlagged,
    FlashcardSourceInfo? SourceInfo = null,
    DateTimeOffset CreatedAt = default,
    DateTimeOffset UpdatedAt = default)
{
    /// <summary>The authored text of one field, or empty when the fact does not fill it.</summary>
    public string Value(string fieldId) =>
        Values.TryGetValue(fieldId, out var value) ? value : string.Empty;

    /// <summary>The attachments on one field, or empty when it carries none.</summary>
    public IReadOnlyList<FlashcardAttachment> MediaOn(string fieldId) =>
        Media.TryGetValue(fieldId, out var items) ? items : [];
}
