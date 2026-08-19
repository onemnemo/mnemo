namespace Mnemo.Core.Models.Flashcards;

/// <summary>
/// One named slot on a card type. A fact fills every field it has a value for; a layout
/// references fields by <see cref="Name"/> through <c>{{Name}}</c> markers.
/// </summary>
/// <param name="Id">
/// Stable key for the value in <see cref="FlashcardFact.Values"/>. Renaming a field changes
/// <see cref="Name"/> and leaves this alone, so existing facts keep their content.
/// </param>
/// <param name="Hint">
/// Placeholder for the empty editor field. Says what belongs there rather than restating the
/// field name. Null when the name is self-explanatory.
/// </param>
public sealed record FlashcardField(
    string Id,
    string Name,
    string? Hint = null);
