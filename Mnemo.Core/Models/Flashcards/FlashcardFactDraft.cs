namespace Mnemo.Core.Models.Flashcards;

/// <summary>
/// What the editor sends when someone saves material: the field values, the media on each field,
/// and where it lives. The cards it makes are worked out from the card type, never sent.
/// </summary>
/// <param name="Id">Null for new material; the id of the fact being edited otherwise.</param>
/// <param name="Cards">
/// What another app knew about the cards this material makes, keyed by the layout each one stands
/// for. Set by an import, the only caller whose cards arrive with a history; null everywhere else,
/// where a newly made card starts New, due now, and active.
/// </param>
public sealed record FlashcardFactDraft(
    string? Id,
    string DeckId,
    string TypeId,
    IReadOnlyDictionary<string, string> Values,
    IReadOnlyDictionary<string, IReadOnlyList<FlashcardAttachment>> Media,
    IReadOnlyList<string> Tags,
    IReadOnlyDictionary<string, FlashcardImportedCard>? Cards = null);

/// <summary>Material as it was saved, with the cards it now makes.</summary>
public sealed record FlashcardFactSaved(
    FlashcardFact Fact,
    IReadOnlyList<Flashcard> Cards,
    int Added,
    int Removed);
