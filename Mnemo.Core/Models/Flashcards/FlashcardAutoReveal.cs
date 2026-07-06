namespace Mnemo.Core.Models.Flashcards;

/// <summary>
/// Auto-reveal behaviour for a review session: how long the front is shown before the
/// answer is revealed automatically. Persisted on a <see cref="FlashcardPreset"/>.
/// </summary>
public enum FlashcardAutoReveal
{
    Off = 0,
    FiveSeconds = 1,
    TenSeconds = 2
}
