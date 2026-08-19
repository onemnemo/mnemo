namespace Mnemo.Core.Models.Flashcards;

/// <summary>
/// A layout that exists but is not currently making a card, and the field that would switch it on.
/// The editor shows these beside the real cards so a fact that quietly makes two cards instead of
/// three is visible while it is being written rather than months later in the statistics.
/// </summary>
/// <param name="NeedsFieldName">
/// Display name of the field the layout requires, or empty when the type no longer has it.
/// </param>
public sealed record FlashcardDormantLayout(
    FlashcardLayout Layout,
    string NeedsFieldName);
