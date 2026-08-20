using Mnemo.Core.Models.Flashcards;

namespace Mnemo.Core.Services;

/// <summary>
/// The review log as a transfer reads and writes it: history going out to another app, and
/// history arriving from one.
/// </summary>
/// <remarks>
/// Separate from <see cref="IFlashcardStudyService"/> on purpose. That surface writes one answer
/// at the moment it is given, together with the schedule and the day's counters it changes. This
/// one moves answers that were given elsewhere, long ago, and must touch nothing but the log:
/// carrying a package's history in is not a day of studying, and must not count as one.
/// </remarks>
public interface IFlashcardReviewHistoryService
{
    /// <summary>
    /// Every answer recorded against the given cards, oldest first, grouped by card.
    /// </summary>
    /// <remarks>
    /// Only cards the library can still see are read. A card the trash is holding keeps its
    /// history, and a selected export must not ship it.
    /// </remarks>
    Task<IReadOnlyList<FlashcardReviewLog>> ListForCardsAsync(
        IReadOnlyList<string> cardIds, CancellationToken cancellationToken = default);

    /// <summary>
    /// Appends history that came from somewhere else, in one write.
    /// </summary>
    /// <returns>How many rows were written.</returns>
    Task<int> AddImportedAsync(
        IReadOnlyList<FlashcardReviewLog> reviews, CancellationToken cancellationToken = default);
}
