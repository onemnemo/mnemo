using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.Flashcards.Persistence;

namespace Mnemo.Infrastructure.Services.Flashcards;

/// <inheritdoc />
public sealed class FlashcardCardService : IFlashcardCardService
{
    private const int SearchLimit = 50;

    private readonly IFlashcardStore _store;
    private readonly ICardRepository _cards;
    private readonly IScheduleRepository _schedules;
    private readonly FlashcardClock _clock;

    public FlashcardCardService(IFlashcardStore store, ICardRepository cards, IScheduleRepository schedules, FlashcardClock clock)
    {
        _store = store;
        _cards = cards;
        _schedules = schedules;
        _clock = clock;
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
        var card = FromDraft(draft, now);
        await _store.WriteAsync(async (conn, tx, ct) =>
        {
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
            .Select(d => (Draft: d, Card: FromDraft(d, now)))
            .ToArray();
        await _store.WriteAsync(async (conn, tx, ct) =>
        {
            foreach (var (draft, card) in prepared)
            {
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

    public Task DeleteCardsAsync(IReadOnlyList<string> cardIds, CancellationToken cancellationToken = default) =>
        _store.WriteAsync((conn, tx, ct) => _cards.DeleteManyAsync(conn, tx, cardIds, ct), cancellationToken);

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
