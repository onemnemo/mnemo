using Mnemo.Core.Models.Flashcards;

namespace Mnemo.Core.Services;

/// <summary>
/// Fits a preset's FSRS weights to the review history of the decks bound to it.
/// </summary>
/// <remarks>
/// Weights belong to a preset, not to a deck, so a fit covers every deck sharing the preset and
/// applying it changes scheduling for all of them.
/// </remarks>
public interface IFlashcardOptimizerService
{
    /// <summary>
    /// Fits a candidate weight vector. Returns null when no preset has that id.
    /// </summary>
    /// <remarks>
    /// Stores nothing. The work is CPU bound and can take seconds on a large collection, so the
    /// cancellation token is honoured throughout.
    /// </remarks>
    Task<FlashcardWeightOptimization?> OptimizePresetAsync(string presetId, CancellationToken cancellationToken = default);
}
