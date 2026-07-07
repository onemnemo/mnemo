namespace Mnemo.Core.Models.Flashcards;

/// <summary>
/// Scheduling algorithm used to update card due dates and memory state. FSRS is the only supported
/// algorithm; the value is kept as an enum (rather than inlined) so the preset schema and .mnemo
/// payload can carry a stable, forward-compatible scheduler discriminant.
/// </summary>
public enum FlashcardSchedulingAlgorithm
{
    Fsrs = 1
}
