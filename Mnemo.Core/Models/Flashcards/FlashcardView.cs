namespace Mnemo.Core.Models.Flashcards;

/// <summary>
/// A read/UI composite pairing a card's content with its FSRS schedule, so the study engine and
/// deck view can consume both without juggling two objects.
/// </summary>
public sealed record FlashcardView(
    Flashcard Card,
    FlashcardSchedule Schedule);
