using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards.Persistence;

namespace Mnemo.Infrastructure.Services.Flashcards.Generation;

/// <summary>What saving a fact did to the cards it makes.</summary>
public readonly record struct FlashcardMaterializeResult(int Added, int Updated, int Removed);

/// <summary>
/// Brings a fact's cards in line with what it currently generates: new layouts and new deletions
/// get a card, the ones that are still there keep theirs, and the ones that are gone lose theirs.
/// </summary>
/// <remarks>
/// A card is matched to its layout by key, never by position or by content, so renaming a field
/// or rewriting a sentence does not cost anyone their progress. Removing a cloze deletion does
/// take the card it made, along with its schedule, because there is nothing left for it to ask.
/// </remarks>
public sealed class FlashcardCardMaterializer
{
    private readonly ICardRepository _cards;
    private readonly IScheduleRepository _schedules;
    private readonly IFactRepository _facts;

    public FlashcardCardMaterializer(ICardRepository cards, IScheduleRepository schedules, IFactRepository facts)
    {
        _cards = cards;
        _schedules = schedules;
        _facts = facts;
    }

    /// <summary>
    /// Whether a fact would make any card at all. Callers saving one fact check this first and
    /// refuse the save, so nobody loses their cards to a half finished edit.
    /// </summary>
    public static bool WouldMakeCards(FlashcardCardType type, FlashcardFact fact) =>
        FlashcardGeneration.Generate(type, fact).Count > 0;

    /// <summary>
    /// Rebuilds the cards a fact makes. A fact that currently makes none is left exactly as it is:
    /// deleting every card of a fact is never something this decides on its own.
    /// </summary>
    /// <param name="previousDeckId">
    /// The deck the fact was filed under before this save, or null for a fact that is being
    /// created. Passing the fact's own current deck here (rather than null) tells this call that
    /// the material is not moving, so a card someone filed elsewhere on its own is left there.
    /// </param>
    public async Task<FlashcardMaterializeResult> ApplyAsync(
        SqliteConnection conn,
        SqliteTransaction tx,
        FlashcardCardType type,
        FlashcardFact fact,
        string? previousDeckId,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(type);
        ArgumentNullException.ThrowIfNull(fact);

        var generated = FlashcardGeneration.Generate(type, fact);
        if (generated.Count == 0)
            return default;

        var existing = (await _facts.GetCardKeysAsync(conn, fact.Id, cancellationToken).ConfigureAwait(false))
            .ToDictionary(k => k.LayoutKey, k => k.CardId, StringComparer.Ordinal);

        var cardType = string.Equals(type.Generator, FlashcardGenerators.Cloze, StringComparison.Ordinal)
            ? FlashcardType.Cloze
            : FlashcardType.Classic;

        // The material itself moving to a new deck takes every card it makes along, even one that
        // had been filed elsewhere on its own; that is what re-homing the whole piece of material
        // means. Anything else that reaches this call, a rewording or a card type edit, leaves a
        // card's deck exactly where it was.
        var factMoved = previousDeckId is not null
            && !string.Equals(previousDeckId, fact.DeckId, StringComparison.Ordinal);

        var added = 0;
        var updated = 0;
        foreach (var card in generated)
        {
            if (existing.Remove(card.Key, out var cardId))
            {
                await UpdateAsync(conn, tx, cardId, fact, card, cardType, factMoved, now, cancellationToken).ConfigureAwait(false);
                updated++;
                continue;
            }

            await InsertAsync(conn, tx, fact, card, cardType, now, cancellationToken).ConfigureAwait(false);
            added++;
        }

        // Whatever is left in the map no longer has a layout behind it.
        var orphaned = existing.Values.ToArray();
        await _cards.DeleteManyAsync(conn, tx, orphaned, cancellationToken).ConfigureAwait(false);

        return new FlashcardMaterializeResult(added, updated, orphaned.Length);
    }

    private async Task UpdateAsync(
        SqliteConnection conn, SqliteTransaction tx, string cardId, FlashcardFact fact,
        FlashcardGeneratedCard generated, FlashcardType cardType, bool factMoved, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var current = await _cards.GetAsync(conn, cardId, cancellationToken).ConfigureAwait(false);
        if (current is null)
            return;

        // Suspension and the flag stay with the card, because they are things someone did to this
        // card while studying it. The deck stays too, unless the material itself just moved: a
        // card filed elsewhere on its own keeps that filing through an ordinary edit, but re-homing
        // the whole piece of material is explicit enough to take its cards along.
        await _cards.UpdateAsync(conn, tx, current with
        {
            DeckId = factMoved ? fact.DeckId : current.DeckId,
            Type = cardType,
            Front = generated.Front,
            Back = generated.Back,
            Tags = fact.Tags,
            Attachments = Sided(generated),
            SourceInfo = fact.SourceInfo,
            UpdatedAt = now,
        }, cancellationToken).ConfigureAwait(false);
    }

    private async Task InsertAsync(
        SqliteConnection conn, SqliteTransaction tx, FlashcardFact fact,
        FlashcardGeneratedCard generated, FlashcardType cardType, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var card = new Flashcard(
            Id: Guid.NewGuid().ToString("N"),
            DeckId: fact.DeckId,
            Type: cardType,
            Front: generated.Front,
            Back: generated.Back,
            Tags: fact.Tags,
            State: FlashcardCardState.Active,
            IsFlagged: fact.IsFlagged,
            Attachments: Sided(generated),
            SourceInfo: fact.SourceInfo,
            FrontBlocks: null,
            BackBlocks: null,
            CreatedAt: now,
            UpdatedAt: now,
            FactId: fact.Id,
            LayoutKey: generated.Key);

        await _cards.InsertAsync(conn, tx, card, cancellationToken).ConfigureAwait(false);
        await _schedules.UpsertAsync(conn, tx, FlashcardSchedule.NewFor(card.Id, now), cancellationToken).ConfigureAwait(false);
    }

    /// <summary>
    /// The media a generated card carries, tagged with the side it is shown on. The fact keeps
    /// media per field; a card only has two places to put it.
    /// </summary>
    private static IReadOnlyList<FlashcardAttachment> Sided(FlashcardGeneratedCard generated) =>
    [
        .. generated.FrontMedia.Select(a => a with { Side = FlashcardAttachment.FrontSide }),
        .. generated.BackMedia.Select(a => a with { Side = FlashcardAttachment.BackSide }),
    ];
}
