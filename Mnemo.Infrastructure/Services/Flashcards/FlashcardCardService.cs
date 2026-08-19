using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.Flashcards.Generation;
using Mnemo.Infrastructure.Services.Flashcards.Persistence;

namespace Mnemo.Infrastructure.Services.Flashcards;

/// <inheritdoc />
public sealed class FlashcardCardService : IFlashcardCardService
{
    private const int SearchLimit = 50;

    private readonly IFlashcardStore _store;
    private readonly ICardRepository _cards;
    private readonly IScheduleRepository _schedules;
    private readonly IFactRepository _facts;
    private readonly FlashcardClock _clock;
    private readonly IImageAssetService? _images;

    public FlashcardCardService(
        IFlashcardStore store,
        ICardRepository cards,
        IScheduleRepository schedules,
        IFactRepository facts,
        FlashcardClock clock,
        IImageAssetService? images = null)
    {
        _store = store;
        _cards = cards;
        _schedules = schedules;
        _facts = facts;
        _clock = clock;
        _images = images;
    }

    public Task<FlashcardCardPage> ListCardsAsync(FlashcardCardQuery query, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(query);
        return _store.ReadAsync((conn, ct) => _cards.GetPageAsync(conn, query, _clock.Now, ct), cancellationToken);
    }

    public Task<Flashcard?> GetCardAsync(string cardId, CancellationToken cancellationToken = default) =>
        _store.ReadAsync((conn, ct) => _cards.GetAsync(conn, cardId, ct), cancellationToken);

    public async Task<Flashcard> CreateCardAsync(FlashcardCardDraft draft, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(draft);
        var now = _clock.Now;
        var (fact, card) = FlashcardCardMaterial.For(FromDraft(draft, now), now);
        await _store.WriteAsync(async (conn, tx, ct) =>
        {
            await _facts.UpsertAsync(conn, tx, fact, ct).ConfigureAwait(false);
            await _cards.InsertAsync(conn, tx, card, ct).ConfigureAwait(false);
            await _schedules.UpsertAsync(conn, tx, ScheduleFor(draft, card.Id, now), ct).ConfigureAwait(false);
        }, cancellationToken).ConfigureAwait(false);
        return card;
    }

    public async Task<IReadOnlyList<Flashcard>> CreateCardsAsync(string deckId, IReadOnlyList<FlashcardCardDraft> drafts, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(drafts);
        var now = _clock.Now;
        var prepared = drafts
            .Select(d => d with { DeckId = deckId })
            .Select(d =>
            {
                var (fact, card) = FlashcardCardMaterial.For(FromDraft(d, now), now);
                return (Draft: d, Fact: fact, Card: card);
            })
            .ToArray();
        await _store.WriteAsync(async (conn, tx, ct) =>
        {
            foreach (var (draft, fact, card) in prepared)
            {
                await _facts.UpsertAsync(conn, tx, fact, ct).ConfigureAwait(false);
                await _cards.InsertAsync(conn, tx, card, ct).ConfigureAwait(false);
                await _schedules.UpsertAsync(conn, tx, ScheduleFor(draft, card.Id, now), ct).ConfigureAwait(false);
            }
        }, cancellationToken).ConfigureAwait(false);
        return prepared.Select(p => p.Card).ToArray();
    }

    /// <summary>
    /// The schedule a new card starts on: whatever an import carried in, or New and due now.
    /// A carried schedule keeps its due date rather than being reset, so importing a studied
    /// collection does not make every card in it due at once.
    /// </summary>
    private static FlashcardSchedule ScheduleFor(FlashcardCardDraft draft, string cardId, DateTimeOffset now) =>
        draft.Schedule?.ToSchedule(cardId) ?? FlashcardSchedule.NewFor(cardId, now);

    public Task UpdateCardAsync(Flashcard card, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(card);
        ValidateAttachments(card.Attachments);
        var updated = card with { UpdatedAt = _clock.Now };
        return _store.WriteAsync((conn, tx, ct) => _cards.UpdateAsync(conn, tx, updated, ct), cancellationToken);
    }

    /// <summary>
    /// Deletes cards and the files behind them. A card made from material shares its attachment
    /// files with every other card the same material makes, so deleting one only takes a file
    /// once nothing is left with a claim on it: for a card with no material, that is itself; for
    /// one with material, that is the material, once this delete leaves it with no card anywhere.
    /// </summary>
    public async Task DeleteCardsAsync(IReadOnlyList<string> cardIds, CancellationToken cancellationToken = default)
    {
        var owned = await _store.WriteAsync(async (conn, tx, ct) =>
        {
            var files = new List<string>();
            var factIds = new HashSet<string>(StringComparer.Ordinal);
            foreach (var id in cardIds)
            {
                var card = await _cards.GetAsync(conn, id, ct).ConfigureAwait(false);
                if (card is null)
                    continue;
                if (card.FactId is { } factId)
                    factIds.Add(factId);
                else
                    files.AddRange(card.Attachments.Select(a => a.FilePath));
            }

            await _cards.DeleteManyAsync(conn, tx, cardIds, ct).ConfigureAwait(false);

            foreach (var factId in factIds)
            {
                var remaining = await _facts.GetCardKeysAsync(conn, factId, ct).ConfigureAwait(false);
                if (remaining.Count > 0)
                    continue;

                var fact = await _facts.GetAsync(conn, factId, ct).ConfigureAwait(false);
                if (fact is null)
                    continue;

                files.AddRange(fact.Media.Values.SelectMany(list => list).Select(a => a.FilePath));
                await _facts.DeleteManyAsync(conn, tx, new[] { factId }, ct).ConfigureAwait(false);
            }

            return files;
        }, cancellationToken).ConfigureAwait(false);

        await FlashcardAttachmentCleanup.DeleteAsync(_images, owned, cancellationToken).ConfigureAwait(false);
    }

    public Task MoveCardsAsync(IReadOnlyList<string> cardIds, string targetDeckId, CancellationToken cancellationToken = default) =>
        _store.WriteAsync((conn, tx, ct) => _cards.MoveManyAsync(conn, tx, cardIds, targetDeckId, _clock.Now, ct), cancellationToken);

    public Task SetSuspendedAsync(IReadOnlyList<string> cardIds, bool suspended, CancellationToken cancellationToken = default) =>
        _store.WriteAsync((conn, tx, ct) => _cards.SetSuspendedAsync(conn, tx, cardIds, suspended, _clock.Now, ct), cancellationToken);

    public Task SetFlaggedAsync(IReadOnlyList<string> cardIds, bool flagged, CancellationToken cancellationToken = default) =>
        _store.WriteAsync((conn, tx, ct) => _cards.SetFlaggedAsync(conn, tx, cardIds, flagged, _clock.Now, ct), cancellationToken);

    public Task AddTagAsync(IReadOnlyList<string> cardIds, string tag, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(tag) || cardIds.Count == 0)
            return Task.CompletedTask;
        var trimmed = tag.Trim();
        var now = _clock.Now;
        return _store.WriteAsync(async (conn, tx, ct) =>
        {
            foreach (var id in cardIds)
            {
                var card = await _cards.GetAsync(conn, id, ct).ConfigureAwait(false);
                if (card is null || card.Tags.Contains(trimmed, StringComparer.OrdinalIgnoreCase))
                    continue;
                var tags = card.Tags.Append(trimmed).ToArray();
                await _cards.UpdateAsync(conn, tx, card with { Tags = tags, UpdatedAt = now }, ct).ConfigureAwait(false);
            }
        }, cancellationToken);
    }

    public Task<IReadOnlyList<Flashcard>> SearchAsync(string query, FlashcardSearchScope scope, CancellationToken cancellationToken = default) =>
        _store.ReadAsync((conn, ct) => _cards.SearchAsync(conn, query, scope, SearchLimit, ct), cancellationToken);

    private static Flashcard FromDraft(FlashcardCardDraft draft, DateTimeOffset now)
    {
        ValidateAttachments(draft.Attachments);
        return new Flashcard(
            Id: Guid.NewGuid().ToString("N"),
            DeckId: draft.DeckId,
            Type: draft.Type,
            Front: draft.Front,
            Back: draft.Back,
            Tags: draft.Tags ?? Array.Empty<string>(),
            State: draft.State,
            IsFlagged: false,
            Attachments: draft.Attachments ?? Array.Empty<FlashcardAttachment>(),
            SourceInfo: draft.SourceInfo,
            FrontBlocks: draft.FrontBlocks,
            BackBlocks: draft.BackBlocks,
            CreatedAt: now,
            UpdatedAt: now);
    }

    private static void ValidateAttachments(IReadOnlyList<FlashcardAttachment>? attachments)
    {
        if (attachments is null || attachments.Count == 0)
            return;
        foreach (var side in new[] { FlashcardAttachment.FrontSide, FlashcardAttachment.BackSide })
        {
            var count = attachments.Count(a => string.Equals(a.Side, side, StringComparison.OrdinalIgnoreCase));
            if (count > IFlashcardCardService.MaxAttachmentsPerSide)
                throw new ArgumentException(
                    $"A card side may have at most {IFlashcardCardService.MaxAttachmentsPerSide} attachments (got {count} on '{side}').",
                    nameof(attachments));
        }
    }
}
