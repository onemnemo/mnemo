namespace Mnemo.Core.Models.Flashcards;

/// <summary>
/// Discriminator for flashcard content shape.
/// </summary>
public enum FlashcardType
{
    Classic = 0,
    Cloze = 1,

    /// <summary>One card per mask on an image. Persisted as an int, so the value never moves.</summary>
    Occlusion = 2
}
