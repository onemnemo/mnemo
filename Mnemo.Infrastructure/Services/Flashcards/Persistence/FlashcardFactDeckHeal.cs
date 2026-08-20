using System.Threading.Tasks;

namespace Mnemo.Infrastructure.Services.Flashcards.Persistence;

/// <summary>
/// Refiles material that is left naming a deck row nobody has any more.
/// </summary>
/// <remarks>
/// <para>
/// Deleting a deck used to take the deck row while leaving the material filed under it pointing at
/// the id, so a fact whose cards had been moved elsewhere survived as a row naming a deck that no
/// longer existed. Deck deletion refiles such material now, but a profile written before that fix
/// can still be carrying the rows it made, and nothing at runtime goes back to look.
/// </para>
/// <para>
/// The repair is the same answer the delete gives: the material moves to the deck one of its own
/// cards is actually in. The card is picked the way <see cref="ICardRepository.GetFactDeckAsync"/>
/// picks it, a live card ahead of one the trash is holding, then the oldest, then by id, so two
/// runs of this on the same data reach the same deck.
/// </para>
/// <para>
/// Material with no cards left at all is not touched. There is nothing to point it at, and a
/// guess would be worse than a row that is honestly stranded. Material naming a deck the trash is
/// holding is not touched either: that deck row exists and is somebody's to restore.
/// </para>
/// </remarks>
internal static class FlashcardFactDeckHeal
{
    public static async Task ApplyAsync(FlashcardMigrationContext context)
    {
        await using var cmd = context.CreateCommand();
        cmd.CommandText = """
            UPDATE FlashcardFacts
            SET DeckId = (
                SELECT c.DeckId FROM FlashcardCards c
                WHERE c.FactId = FlashcardFacts.Id
                ORDER BY (c.TrashId IS NULL) DESC, c.CreatedAt, c.Id
                LIMIT 1)
            WHERE NOT EXISTS (SELECT 1 FROM FlashcardDecks d WHERE d.Id = FlashcardFacts.DeckId)
              AND EXISTS (SELECT 1 FROM FlashcardCards c WHERE c.FactId = FlashcardFacts.Id);
            """;
        await cmd.ExecuteNonQueryAsync(context.CancellationToken).ConfigureAwait(false);
    }
}
