using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.Flashcards.Generation;
using Mnemo.Infrastructure.Services.Flashcards.Persistence;
using Mnemo.Infrastructure.Services.Flashcards.Trash;
using Mnemo.Infrastructure.Services.Trash;

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

    public FlashcardFactService(
        IFlashcardStore store,
        IFactRepository facts,
        ICardTypeRepository types,
        ICardRepository cards,
        FlashcardCardMaterializer materializer,
        FlashcardClock clock)
    {
        _store = store;
        _facts = facts;
        _types = types;
        _cards = cards;
        _materializer = materializer;
        _clock = clock;
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
                {
                    await _materializer
                        .ApplyAsync(conn, tx, saved, fact, fact.DeckId, importedCards: null, now, ct)
                        .ConfigureAwait(false);
                }
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

            // Trashed material retains its type id. Keep the type until those references are
            // removed.
            var held = await _types.CountAllFactsAsync(conn, typeId, ct).ConfigureAwait(false);
            if (held > 0)
                throw new InvalidOperationException($"This card type still holds {held} pieces of material in the trash.");

            return await _types.DeleteAsync(conn, tx, typeId, ct).ConfigureAwait(false);
        }, cancellationToken);

    public Task<FlashcardFact?> GetFactAsync(string factId, CancellationToken cancellationToken = default) =>
        _store.ReadAsync((conn, ct) => _facts.GetAsync(conn, factId, ct), cancellationToken);

    public Task<FlashcardFact?> GetFactForCardAsync(string cardId, CancellationToken cancellationToken = default) =>
        _store.ReadAsync((conn, ct) => _facts.GetByCardAsync(conn, cardId, ct), cancellationToken);

    public async Task<FlashcardFactSaved> SaveFactAsync(FlashcardFactDraft draft, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(draft);
        var saved = await SaveFactsAsync([draft], cancellationToken).ConfigureAwait(false);
        return saved[0];
    }

    public async Task<IReadOnlyList<FlashcardFactSaved>> SaveFactsAsync(
        IReadOnlyList<FlashcardFactDraft> drafts, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(drafts);
        if (drafts.Count == 0)
            return [];

        var now = _clock.Now;
        return await _store.WriteAsync(async (conn, tx, ct) =>
        {
            // A package imports under a handful of types across thousands of notes, so the type is
            // read once rather than once per draft.
            var types = new Dictionary<string, FlashcardCardType>(StringComparer.Ordinal);
            var saved = new List<FlashcardFactSaved>(drafts.Count);
            foreach (var draft in drafts)
                saved.Add(await SaveOneAsync(conn, tx, draft, types, now, ct).ConfigureAwait(false));

            return (IReadOnlyList<FlashcardFactSaved>)saved;
        }, cancellationToken).ConfigureAwait(false);
    }

    private async Task<FlashcardFactSaved> SaveOneAsync(
        SqliteConnection conn,
        SqliteTransaction tx,
        FlashcardFactDraft draft,
        Dictionary<string, FlashcardCardType> types,
        DateTimeOffset now,
        CancellationToken ct)
    {
        if (!types.TryGetValue(draft.TypeId, out var type))
        {
            type = await _types.GetAsync(conn, draft.TypeId, ct).ConfigureAwait(false)
                ?? throw new ArgumentException($"There is no card type '{draft.TypeId}'.", nameof(draft));
            types[draft.TypeId] = type;
        }

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
        var result = await _materializer
            .ApplyAsync(conn, tx, type, fact, existing?.DeckId, draft.Cards, now, ct)
            .ConfigureAwait(false);

        var keys = await _facts.GetCardKeysAsync(conn, fact.Id, ct).ConfigureAwait(false);
        var cards = new List<Flashcard>(keys.Count);
        foreach (var key in keys)
        {
            if (await _cards.GetAsync(conn, key.CardId, ct).ConfigureAwait(false) is { } card)
                cards.Add(card);
        }

        await AssetCleanupQueue
            .EnqueueAsync(conn, tx, FlashcardAssetReferences.AssetOwner, DroppedMediaPaths(existing, fact), now, ct)
            .ConfigureAwait(false);

        return new FlashcardFactSaved(fact, cards, result.Added, result.Removed);
    }

    /// <summary>
    /// Deletes material and the files behind it. Every card the material makes shares its
    /// attachment files with it and cascades away with the same delete, so collecting the
    /// material's own media here also accounts for theirs; nothing further is needed per card.
    /// </summary>
    public Task DeleteFactsAsync(IReadOnlyList<string> factIds, CancellationToken cancellationToken = default) =>
        _store.WriteAsync(async (conn, tx, ct) =>
        {
            var files = new List<string>();
            foreach (var id in factIds)
            {
                var fact = await _facts.GetAsync(conn, id, ct).ConfigureAwait(false);
                if (fact is not null)
                    files.AddRange(fact.Media.Values.SelectMany(list => list).Select(a => a.FilePath));
            }

            // A card of this material that the trash is holding is somebody's to get back, so it is
            // cut loose first and lives on as a freeform card instead of cascading away with it.
            await FlashcardTrashCascade.DetachHeldCardsAsync(conn, tx, factIds, ct).ConfigureAwait(false);

            await _facts.DeleteManyAsync(conn, tx, factIds, ct).ConfigureAwait(false);
            await AssetCleanupQueue
                .EnqueueAsync(conn, tx, FlashcardAssetReferences.AssetOwner, files, _clock.Now, ct)
                .ConfigureAwait(false);
        }, cancellationToken);

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
