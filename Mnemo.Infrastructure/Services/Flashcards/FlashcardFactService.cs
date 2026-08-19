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
public sealed class FlashcardFactService : IFlashcardFactService
{
    private readonly IFlashcardStore _store;
    private readonly IFactRepository _facts;
    private readonly ICardTypeRepository _types;
    private readonly ICardRepository _cards;
    private readonly FlashcardCardMaterializer _materializer;
    private readonly FlashcardClock _clock;
    private readonly IImageAssetService? _images;

    public FlashcardFactService(
        IFlashcardStore store,
        IFactRepository facts,
        ICardTypeRepository types,
        ICardRepository cards,
        FlashcardCardMaterializer materializer,
        FlashcardClock clock,
        IImageAssetService? images = null)
    {
        _store = store;
        _facts = facts;
        _types = types;
        _cards = cards;
        _materializer = materializer;
        _clock = clock;
        _images = images;
    }

    public Task<IReadOnlyList<FlashcardCardType>> ListCardTypesAsync(CancellationToken cancellationToken = default) =>
        _store.ReadAsync((conn, ct) => _types.ListAsync(conn, ct), cancellationToken);

    public Task<FlashcardCardType?> GetCardTypeAsync(string typeId, CancellationToken cancellationToken = default) =>
        _store.ReadAsync((conn, ct) => _types.GetAsync(conn, typeId, ct), cancellationToken);

    public Task<int> CountFactsUsingTypeAsync(string typeId, CancellationToken cancellationToken = default) =>
        _store.ReadAsync((conn, ct) => _types.CountFactsAsync(conn, typeId, ct), cancellationToken);

    public async Task<FlashcardCardType> SaveCardTypeAsync(FlashcardCardType type, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(type);
        var now = _clock.Now;

        return await _store.WriteAsync(async (conn, tx, ct) =>
        {
            var previous = await _types.GetAsync(conn, type.Id, ct).ConfigureAwait(false);
            if (previous is not null && previous.IsBuiltIn && !type.IsBuiltIn)
                throw new ArgumentException("A built in card type cannot stop being one.", nameof(type));

            var saved = FlashcardCardTypeEdit.CarryRenames(previous, type) with
            {
                IsBuiltIn = previous?.IsBuiltIn ?? type.IsBuiltIn,
                CreatedAt = previous?.CreatedAt ?? now,
                UpdatedAt = now,
            };
            FlashcardCardTypeEdit.Validate(saved);
            await _types.UpsertAsync(conn, tx, saved, ct).ConfigureAwait(false);

            // Templates and layouts describe cards that already exist, so the edit has to reach
            // them. A fact that would now make nothing keeps the cards it has rather than losing
            // them to someone else's edit.
            if (previous is not null)
            {
                foreach (var fact in await _facts.ListByTypeAsync(conn, saved.Id, ct).ConfigureAwait(false))
                    await _materializer.ApplyAsync(conn, tx, saved, fact, now, ct).ConfigureAwait(false);
            }

            return saved;
        }, cancellationToken).ConfigureAwait(false);
    }

    public Task<bool> DeleteCardTypeAsync(string typeId, CancellationToken cancellationToken = default) =>
        _store.WriteAsync(async (conn, tx, ct) =>
        {
            var used = await _types.CountFactsAsync(conn, typeId, ct).ConfigureAwait(false);
            if (used > 0)
                throw new InvalidOperationException($"This card type still holds {used} pieces of material.");
            return await _types.DeleteAsync(conn, tx, typeId, ct).ConfigureAwait(false);
        }, cancellationToken);

    public Task<FlashcardFact?> GetFactAsync(string factId, CancellationToken cancellationToken = default) =>
        _store.ReadAsync((conn, ct) => _facts.GetAsync(conn, factId, ct), cancellationToken);

    public Task<FlashcardFact?> GetFactForCardAsync(string cardId, CancellationToken cancellationToken = default) =>
        _store.ReadAsync((conn, ct) => _facts.GetByCardAsync(conn, cardId, ct), cancellationToken);

    public async Task<FlashcardFactSaved> SaveFactAsync(FlashcardFactDraft draft, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(draft);
        var now = _clock.Now;

        var (saved, dropped) = await _store.WriteAsync(async (conn, tx, ct) =>
        {
            var type = await _types.GetAsync(conn, draft.TypeId, ct).ConfigureAwait(false)
                ?? throw new ArgumentException($"There is no card type '{draft.TypeId}'.", nameof(draft));

            var existing = draft.Id is null
                ? null
                : await _facts.GetAsync(conn, draft.Id, ct).ConfigureAwait(false);

            var fact = new FlashcardFact(
                Id: existing?.Id ?? Guid.NewGuid().ToString("N"),
                DeckId: draft.DeckId,
                TypeId: draft.TypeId,
                Values: draft.Values,
                Media: draft.Media,
                Tags: draft.Tags,
                IsFlagged: existing?.IsFlagged ?? false,
                SourceInfo: existing?.SourceInfo,
                CreatedAt: existing?.CreatedAt ?? now,
                UpdatedAt: now);

            if (!FlashcardCardMaterializer.WouldMakeCards(type, fact))
                throw new ArgumentException("This would make no cards. Fill in a field a card uses.", nameof(draft));

            await _facts.UpsertAsync(conn, tx, fact, ct).ConfigureAwait(false);
            var result = await _materializer.ApplyAsync(conn, tx, type, fact, now, ct).ConfigureAwait(false);

            var keys = await _facts.GetCardKeysAsync(conn, fact.Id, ct).ConfigureAwait(false);
            var cards = new List<Flashcard>(keys.Count);
            foreach (var key in keys)
            {
                if (await _cards.GetAsync(conn, key.CardId, ct).ConfigureAwait(false) is { } card)
                    cards.Add(card);
            }

            return (new FlashcardFactSaved(fact, cards, result.Added, result.Removed), DroppedMediaPaths(existing, fact));
        }, cancellationToken).ConfigureAwait(false);

        await FlashcardAttachmentCleanup.DeleteAsync(_images, dropped, cancellationToken).ConfigureAwait(false);
        return saved;
    }

    /// <summary>
    /// Deletes material and the files behind it. Every card the material makes shares its
    /// attachment files with it and cascades away with the same delete, so collecting the
    /// material's own media here also accounts for theirs; nothing further is needed per card.
    /// </summary>
    public async Task DeleteFactsAsync(IReadOnlyList<string> factIds, CancellationToken cancellationToken = default)
    {
        var owned = await _store.WriteAsync(async (conn, tx, ct) =>
        {
            var files = new List<string>();
            foreach (var id in factIds)
            {
                var fact = await _facts.GetAsync(conn, id, ct).ConfigureAwait(false);
                if (fact is not null)
                    files.AddRange(fact.Media.Values.SelectMany(list => list).Select(a => a.FilePath));
            }

            await _facts.DeleteManyAsync(conn, tx, factIds, ct).ConfigureAwait(false);
            return files;
        }, cancellationToken).ConfigureAwait(false);

        await FlashcardAttachmentCleanup.DeleteAsync(_images, owned, cancellationToken).ConfigureAwait(false);
    }

    /// <summary>The files an edit removed from the material's fields, kept until now so a save
    /// that fails or is never made never costs anyone a picture.</summary>
    private static IReadOnlyList<string> DroppedMediaPaths(FlashcardFact? before, FlashcardFact after)
    {
        if (before is null)
            return Array.Empty<string>();

        var kept = after.Media.Values.SelectMany(list => list).Select(a => a.Id).ToHashSet(StringComparer.Ordinal);
        return before.Media.Values.SelectMany(list => list)
            .Where(a => !kept.Contains(a.Id))
            .Select(a => a.FilePath)
            .ToArray();
    }
}
