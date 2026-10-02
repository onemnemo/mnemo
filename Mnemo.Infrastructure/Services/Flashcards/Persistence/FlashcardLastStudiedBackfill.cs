using System.Threading.Tasks;

namespace Mnemo.Infrastructure.Services.Flashcards.Persistence;

/// <summary>
/// Gives a deck that has reviews but no last studied time the time of its newest review.
/// </summary>
/// <remarks>
/// A deck that already has a time keeps it, so rerunning changes nothing. Timestamps are stored
/// as fixed-width UTC round-trip strings, so MAX orders them by time.
/// </remarks>
internal static class FlashcardLastStudiedBackfill
{
    public static async Task ApplyAsync(FlashcardMigrationContext context)
    {
        await using var command = context.CreateCommand();
        command.CommandText = """
            UPDATE FlashcardDecks
            SET LastStudied = (SELECT MAX(r.ReviewedAt) FROM FlashcardReviews r WHERE r.DeckId = FlashcardDecks.Id)
            WHERE LastStudied IS NULL
              AND EXISTS (SELECT 1 FROM FlashcardReviews r WHERE r.DeckId = FlashcardDecks.Id);
            """;
        await command.ExecuteNonQueryAsync(context.CancellationToken).ConfigureAwait(false);
    }
}
