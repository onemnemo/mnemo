using Mnemo.Core.Models.Flashcards;

namespace Mnemo.Core.Services;

/// <summary>
/// The three isolated stat buckets. Memory (retention) is sourced only from Review; Test is sourced
/// only from test attempts; the two never mix.
/// </summary>
public interface IFlashcardStatsService
{
    // --- Memory bucket (Review only) ---
    Task<int> GetTrueRetentionAsync(string deckId, int windowDays = 30, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<FlashcardRetentionTrendPoint>> GetRetentionTrendAsync(string deckId, int days = 14, CancellationToken cancellationToken = default);

    // --- Test bucket (isolated) ---
    Task RecordTestAttemptAsync(FlashcardTestAttempt attempt, CancellationToken cancellationToken = default);
    Task<FlashcardTestSummary> GetTestSummaryAsync(string deckId, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<FlashcardTestAttempt>> GetTestTrendAsync(string deckId, int lastN = 20, CancellationToken cancellationToken = default);
}
