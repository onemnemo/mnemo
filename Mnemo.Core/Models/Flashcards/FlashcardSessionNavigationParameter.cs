namespace Mnemo.Core.Models.Flashcards;

/// <summary>
/// Navigation payload for opening the study session shell, shared by Review and Cram. The
/// <see cref="Scope"/> is only meaningful for <see cref="FlashcardSessionMode.Cram"/> (Due vs All);
/// Review always draws the scheduled queue and ignores it. Test is a later slice.
/// </summary>
public sealed record FlashcardSessionNavigationParameter(
    string DeckId,
    FlashcardSessionMode Mode,
    FlashcardSessionScope Scope = FlashcardSessionScope.Due);
