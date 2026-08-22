using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards.Generation;

namespace Mnemo.Infrastructure.Services.Flashcards.Persistence;

/// <summary>
/// Rebuilds the cards of material holding a cloze deletion that wraps a line.
/// </summary>
/// <remarks>
/// <para>
/// Generation used to read a deletion with a pattern that stopped at the first newline, so a
/// deletion written across a line was not counted, not masked and not revealed. Its
/// <c>{{c1::...}}</c> was written verbatim into both sides of every card the material makes, and if
/// its number appeared nowhere else, the card for it was never made at all. Widening the pattern
/// fixes what is generated from now on; cards already written keep the markup until something
/// regenerates them, which is what this does.
/// </para>
/// <para>
/// Only material that is actually out of date is touched. A candidate has to hold a literal marker
/// in one of its stored sides, which is the mark this leaves, and then has to disagree with what
/// generation makes of it now. Material that already reads correctly keeps the timestamps it has,
/// so an upgrade does not report every cloze card in a collection as just edited.
/// </para>
/// <para>
/// Nothing is deleted. Where the widened pattern no longer produces a card the material used to
/// have, this leaves the material alone entirely rather than rebuilding it, because the rebuild
/// would take that card and its whole review history with it. Losing history is a decision for
/// somebody editing their own material, with the editor telling them the count, and not for an
/// upgrade that runs before anyone has opened the app. Such material reconciles itself at the next
/// ordinary save.
/// </para>
/// </remarks>
internal static class FlashcardClozeWrapRepair
{
    public static async Task ApplyAsync(FlashcardMigrationContext context)
    {
        var candidates = await ReadCandidateFactIdsAsync(context).ConfigureAwait(false);
        if (candidates.Count == 0)
            return;

        var types = new CardTypeRepository();
        var facts = new FactRepository();
        var cards = new CardRepository();
        var materializer = new FlashcardCardMaterializer(cards, new ScheduleRepository(), facts);
        var now = context.Time.GetUtcNow();

        foreach (var factId in candidates)
        {
            var fact = await facts.GetAsync(context.Connection, factId, context.CancellationToken).ConfigureAwait(false);
            if (fact is null)
                continue;

            var type = await types.GetAsync(context.Connection, fact.TypeId, context.CancellationToken).ConfigureAwait(false);
            if (type is null)
                continue;

            if (!await IsWorthRebuildingAsync(context, cards, facts, type, fact).ConfigureAwait(false))
                continue;

            // The fact's own deck is passed as the previous one so nothing is treated as a move: a
            // card somebody filed in another deck on its own stays where they put it.
            await materializer.ApplyAsync(
                context.Connection,
                context.Transaction,
                type,
                fact,
                previousDeckId: fact.DeckId,
                importedCards: null,
                now,
                context.CancellationToken).ConfigureAwait(false);
        }
    }

    /// <summary>
    /// Material whose stored cards still show a marker, which is the only way the old pattern left
    /// its mark. Narrowing in SQL first keeps a collection with nothing wrong from reading every
    /// piece of cloze material it has.
    /// </summary>
    private static async Task<IReadOnlyList<string>> ReadCandidateFactIdsAsync(FlashcardMigrationContext context)
    {
        await using var cmd = context.CreateCommand();
        cmd.CommandText = """
            SELECT DISTINCT f.Id
            FROM FlashcardFacts f
            JOIN FlashcardCardTypes t ON t.Id = f.TypeId
            JOIN FlashcardCards c ON c.FactId = f.Id
            WHERE t.Generator = $cloze
              AND f.TrashId IS NULL
              AND (c.Front LIKE '%{{c%' OR c.Back LIKE '%{{c%');
            """;
        cmd.Parameters.AddWithValue("$cloze", FlashcardGenerators.Cloze);

        var ids = new List<string>();
        await using var reader = await cmd.ExecuteReaderAsync(context.CancellationToken).ConfigureAwait(false);
        while (await reader.ReadAsync(context.CancellationToken).ConfigureAwait(false))
            ids.Add(reader.GetString(0));
        return ids;
    }

    /// <summary>
    /// Whether rebuilding this material would change anything, and whether it can be done without
    /// losing a card. False on either count leaves the material untouched.
    /// </summary>
    private static async Task<bool> IsWorthRebuildingAsync(
        FlashcardMigrationContext context,
        ICardRepository cards,
        IFactRepository facts,
        FlashcardCardType type,
        FlashcardFact fact)
    {
        var generated = FlashcardGeneration.Generate(type, fact);
        if (generated.Count == 0)
            return false;

        var keys = await facts.GetCardKeysAsync(context.Connection, fact.Id, context.CancellationToken).ConfigureAwait(false);
        var live = new Dictionary<string, string>(StringComparer.Ordinal);
        var held = new HashSet<string>(StringComparer.Ordinal);
        foreach (var key in keys)
        {
            if (key.IsHeld)
                held.Add(key.LayoutKey);
            else
                live[key.LayoutKey] = key.CardId;
        }

        var produced = new HashSet<string>(StringComparer.Ordinal);
        foreach (var card in generated)
            produced.Add(card.Key);

        // A live card whose layout is no longer produced would be swept by the rebuild. That is a
        // hard delete of its review history, so the whole piece of material is left as it is.
        foreach (var layoutKey in live.Keys)
        {
            if (!produced.Contains(layoutKey))
                return false;
        }

        foreach (var card in generated)
        {
            if (held.Contains(card.Key))
                continue;

            if (!live.TryGetValue(card.Key, out var cardId))
                return true;

            var stored = await cards.GetAsync(context.Connection, cardId, context.CancellationToken).ConfigureAwait(false);
            if (stored is null)
                return true;

            if (!string.Equals(stored.Front, card.Front, StringComparison.Ordinal)
                || !string.Equals(stored.Back, card.Back, StringComparison.Ordinal))
                return true;
        }

        return false;
    }
}
