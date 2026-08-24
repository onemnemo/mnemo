using Mnemo.Core.Enums;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Common;
using Mnemo.Infrastructure.Services.Flashcards;
using Mnemo.Infrastructure.Services.Flashcards.Persistence;
using Mnemo.Infrastructure.Services.Trash;

namespace Mnemo.Infrastructure.Services.Packaging.PayloadHandlers;

/// <summary>
/// Writes a package's snapshot back into a collection, keeping every id the package carries so a
/// restore puts somebody back where they were rather than handing them a copy.
/// </summary>
/// <remarks>
/// Ids are preserved whenever nothing local already owns them. What happens when something does is
/// the conflict policy's decision: keeping both mints fresh ids and carries the remapping through
/// material, cards, schedules and history; skipping leaves local content alone; replacing clears
/// what the deck currently holds and writes the package's rows into the same ids, which is what
/// makes re-importing the same package under replace land the same collection rather than a second
/// copy of it. A row the trash is holding is never written over: the repositories refuse it, and a
/// deck whose id a held row owns is reported as skipped rather than having its cards filed under a
/// deck nobody can open.
/// </remarks>
internal sealed class FlashcardCollectionRestore
{
    private readonly IFlashcardStore _store;
    private readonly IFlashcardPresetService _presetService;
    private readonly IFolderRepository _folders;
    private readonly IDeckRepository _decks;
    private readonly ICardRepository _cards;
    private readonly IFactRepository _facts;
    private readonly ICardTypeRepository _cardTypes;
    private readonly IPresetRepository _presets;
    private readonly IScheduleRepository _schedules;
    private readonly IReviewRepository _reviews;
    private readonly IDailyStatsRepository _dailyStats;
    private readonly ILoggerService _logger;
    private readonly string _imagesDirectory;

    /// <summary>
    /// Builds the restore. <paramref name="imagesDirectory"/> is where the package's image files
    /// have already been written, and is the directory the restored attachment paths are made to
    /// point at, so the rows and the files on disk cannot disagree.
    /// </summary>
    public FlashcardCollectionRestore(
        IFlashcardStore store,
        IFlashcardPresetService presetService,
        IFolderRepository folders,
        IDeckRepository decks,
        ICardRepository cards,
        IFactRepository facts,
        ICardTypeRepository cardTypes,
        IPresetRepository presets,
        IScheduleRepository schedules,
        IReviewRepository reviews,
        IDailyStatsRepository dailyStats,
        ILoggerService logger,
        string imagesDirectory)
    {
        _store = store;
        _presetService = presetService;
        _folders = folders;
        _decks = decks;
        _cards = cards;
        _facts = facts;
        _cardTypes = cardTypes;
        _presets = presets;
        _schedules = schedules;
        _reviews = reviews;
        _dailyStats = dailyStats;
        _logger = logger;
        _imagesDirectory = imagesDirectory;
    }

    public async Task<MnemoPayloadImportResult> RestoreAsync(
        FlashcardPayloadSnapshot snapshot,
        ImportConflictPolicy policy,
        CancellationToken cancellationToken)
    {
        // The fallback profile has to exist before any deck row names one, because the deck table
        // enforces the reference. Minted outside the restore's own transaction, since it has one.
        await _presetService.GetOrCreateStandardAsync(cancellationToken).ConfigureAwait(false);

        var result = new MnemoPayloadImportResult();
        var imagesDirectory = _imagesDirectory;
        var now = DateTimeOffset.UtcNow;

        await _store.WriteAsync(async (conn, tx, ct) =>
        {
            await RestorePresetsAsync(conn, tx, snapshot, policy, ct).ConfigureAwait(false);
            await RestoreCardTypesAsync(conn, tx, snapshot, policy, ct).ConfigureAwait(false);
            var folderMap = await RestoreFoldersAsync(conn, tx, snapshot, policy, result, now, ct).ConfigureAwait(false);
            var deckMap = await RestoreDecksAsync(conn, tx, snapshot, policy, folderMap, result, now, ct).ConfigureAwait(false);
            var factMap = await RestoreFactsAsync(conn, tx, snapshot, policy, deckMap, imagesDirectory, ct).ConfigureAwait(false);
            var cardMap = await RestoreCardsAsync(conn, tx, snapshot, policy, deckMap, factMap, imagesDirectory, now, ct).ConfigureAwait(false);
            await RestoreHistoryAsync(conn, tx, snapshot, deckMap, cardMap, ct).ConfigureAwait(false);
        }, cancellationToken).ConfigureAwait(false);

        return result;
    }

    // ---- Collection wide rows ---------------------------------------------------------------------

    /// <summary>
    /// Scheduling profiles keep their ids. A profile this collection already has wins unless the
    /// import was asked to replace, because a preset is shared: overwriting one from a package
    /// would change how every deck bound to it is scheduled, not only the decks in the package.
    /// </summary>
    private async Task RestorePresetsAsync(
        Microsoft.Data.Sqlite.SqliteConnection conn,
        Microsoft.Data.Sqlite.SqliteTransaction tx,
        FlashcardPayloadSnapshot snapshot,
        ImportConflictPolicy policy,
        CancellationToken cancellationToken)
    {
        foreach (var preset in snapshot.Presets)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (string.IsNullOrWhiteSpace(preset.Id))
                continue;

            var exists = await _presets.ExistsAsync(conn, preset.Id, cancellationToken).ConfigureAwait(false);
            if (exists && policy != ImportConflictPolicy.Replace)
                continue;

            await _presets.UpsertAsync(conn, tx, ToPreset(preset), cancellationToken).ConfigureAwait(false);
        }
    }

    /// <summary>Card types keep their ids, on the same rule as presets: they are collection wide.</summary>
    private async Task RestoreCardTypesAsync(
        Microsoft.Data.Sqlite.SqliteConnection conn,
        Microsoft.Data.Sqlite.SqliteTransaction tx,
        FlashcardPayloadSnapshot snapshot,
        ImportConflictPolicy policy,
        CancellationToken cancellationToken)
    {
        foreach (var type in snapshot.CardTypes)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (string.IsNullOrWhiteSpace(type.Id))
                continue;

            var existing = await _cardTypes.GetAsync(conn, type.Id, cancellationToken).ConfigureAwait(false);
            if (existing is not null && policy != ImportConflictPolicy.Replace)
                continue;

            await _cardTypes.UpsertAsync(conn, tx, ToCardType(type), cancellationToken).ConfigureAwait(false);
        }
    }

    // ---- Library ------------------------------------------------------------------------------

    private async Task<Dictionary<string, string>> RestoreFoldersAsync(
        Microsoft.Data.Sqlite.SqliteConnection conn,
        Microsoft.Data.Sqlite.SqliteTransaction tx,
        FlashcardPayloadSnapshot snapshot,
        ImportConflictPolicy policy,
        MnemoPayloadImportResult result,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var map = new Dictionary<string, string>(StringComparer.Ordinal);
        if (snapshot.Folders.Count == 0)
            return map;

        var existing = await _folders.ListAsync(conn, cancellationToken).ConfigureAwait(false);
        var existingIds = new HashSet<string>(existing.Select(f => f.Id), StringComparer.Ordinal);

        foreach (var folder in snapshot.Folders)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var id = folder.Id;
            if (existingIds.Contains(id))
            {
                if (policy == ImportConflictPolicy.Skip)
                {
                    map[folder.Id] = id;
                    continue;
                }

                if (policy == ImportConflictPolicy.KeepBoth)
                {
                    id = NewId();
                    result.DuplicatedCount++;
                }
            }

            var parentId = folder.ParentId;
            if (!string.IsNullOrWhiteSpace(parentId) && map.TryGetValue(parentId, out var remappedParent))
                parentId = remappedParent;

            map[folder.Id] = id;
            existingIds.Add(id);
            await _folders.UpsertAsync(conn, tx, new FlashcardFolder(id, folder.Name, parentId, folder.Order), now, cancellationToken)
                .ConfigureAwait(false);
        }

        return map;
    }

    private async Task<Dictionary<string, string>> RestoreDecksAsync(
        Microsoft.Data.Sqlite.SqliteConnection conn,
        Microsoft.Data.Sqlite.SqliteTransaction tx,
        FlashcardPayloadSnapshot snapshot,
        ImportConflictPolicy policy,
        IReadOnlyDictionary<string, string> folderMap,
        MnemoPayloadImportResult result,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var map = new Dictionary<string, string>(StringComparer.Ordinal);
        var existing = await _decks.ListHeadersAsync(conn, cancellationToken).ConfigureAwait(false);
        var existingIds = new HashSet<string>(existing.Select(d => d.Id), StringComparer.Ordinal);
        var usedNames = new HashSet<string>(existing.Select(d => d.Name), StringComparer.OrdinalIgnoreCase);

        foreach (var deck in snapshot.Decks)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var deckId = deck.Id;
            var name = deck.Name;

            if (existingIds.Contains(deckId))
            {
                if (policy == ImportConflictPolicy.Skip)
                {
                    result.SkippedCount++;
                    continue;
                }

                if (policy == ImportConflictPolicy.KeepBoth)
                {
                    deckId = NewId();
                    name = ImportNaming.NextAvailableName(name, usedNames);
                    result.DuplicatedCount++;
                }
                else
                {
                    await ClearDeckAsync(conn, tx, deckId, now, cancellationToken).ConfigureAwait(false);
                }
            }

            usedNames.Add(name);
            var folderId = deck.FolderId;
            if (!string.IsNullOrWhiteSpace(folderId) && folderMap.TryGetValue(folderId, out var remappedFolder))
                folderId = remappedFolder;

            var presetId = await ResolvePresetIdAsync(conn, deck.PresetId, cancellationToken).ConfigureAwait(false);
            await _decks.UpsertAsync(conn, tx, new FlashcardDeckHeader(
                Id: deckId,
                FolderId: folderId,
                PresetId: presetId,
                Name: name,
                Description: deck.Description,
                Tags: deck.Tags ?? Array.Empty<string>(),
                SortOrder: deck.SortOrder,
                LastStudied: deck.LastStudied,
                Icon: deck.Icon,
                CreatedAt: deck.CreatedAt ?? now,
                UpdatedAt: deck.UpdatedAt ?? now), cancellationToken).ConfigureAwait(false);

            // A deck id can also collide with one the trash is holding. Nothing above can see that
            // row, and the save leaves it alone rather than overwriting something restorable, so the
            // deck is not there afterwards. Importing its cards regardless would file them under a
            // deck nobody can open, so the deck is reported as skipped instead.
            if (await _decks.GetHeaderAsync(conn, deckId, cancellationToken).ConfigureAwait(false) is null)
            {
                result.SkippedCount++;
                continue;
            }

            existingIds.Add(deckId);
            map[deck.Id] = deckId;
            result.ImportedCount++;
        }

        return map;
    }

    /// <summary>
    /// Takes a deck back to empty so the package's rows can land in it. Cards first, then the
    /// material nothing renders any more: deleting material cascades to its cards, and a card the
    /// user moved to another deck is not this deck's to destroy.
    /// </summary>
    /// <remarks>
    /// Cards are deleted by id rather than left to the cascade behind their material, because the
    /// search index is kept in step by a delete trigger and a foreign key action does not fire one.
    /// The files the destroyed rows named are queued in the same transaction, never deleted here: a
    /// picture is shared between material and every card that material makes, and a restore about
    /// to write those rows back names the same files again, so only the cleanup pass can tell an
    /// orphan from a file something still shows.
    /// </remarks>
    private async Task ClearDeckAsync(
        Microsoft.Data.Sqlite.SqliteConnection conn,
        Microsoft.Data.Sqlite.SqliteTransaction tx,
        string deckId,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var droppedPaths = new HashSet<string>(FlashcardAssetPaths.Comparer);

        var cards = await _cards.ListByDeckAsync(conn, deckId, cancellationToken).ConfigureAwait(false);
        if (cards.Count > 0)
        {
            foreach (var card in cards)
            {
                foreach (var attachment in card.Attachments ?? Array.Empty<FlashcardAttachment>())
                    FlashcardAssetPaths.Add(droppedPaths, attachment.FilePath);
            }

            await _cards.DeleteManyAsync(conn, tx, cards.Select(c => c.Id).ToArray(), cancellationToken).ConfigureAwait(false);
        }

        var facts = await _facts.ListByDeckAsync(conn, deckId, cancellationToken).ConfigureAwait(false);
        var orphaned = new List<FlashcardFact>();
        foreach (var fact in facts)
        {
            var keys = await _facts.GetCardKeysAsync(conn, fact.Id, cancellationToken).ConfigureAwait(false);
            if (keys.Count == 0)
                orphaned.Add(fact);
        }

        if (orphaned.Count > 0)
        {
            foreach (var fact in orphaned)
            {
                foreach (var group in fact.Media.Values)
                {
                    foreach (var attachment in group)
                        FlashcardAssetPaths.Add(droppedPaths, attachment.FilePath);
                }
            }

            await _facts.DeleteManyAsync(conn, tx, orphaned.Select(f => f.Id).ToArray(), cancellationToken).ConfigureAwait(false);
        }

        await _reviews.DeleteForDeckAsync(conn, tx, deckId, cancellationToken).ConfigureAwait(false);
        await _dailyStats.DeleteForDeckAsync(conn, tx, deckId, cancellationToken).ConfigureAwait(false);

        await AssetCleanupQueue.EnqueueAsync(
            conn,
            tx,
            FlashcardAssetReferences.AssetOwner,
            droppedPaths,
            now,
            cancellationToken).ConfigureAwait(false);
    }

    private async Task<string> ResolvePresetIdAsync(
        Microsoft.Data.Sqlite.SqliteConnection conn,
        string? presetId,
        CancellationToken cancellationToken)
    {
        if (!string.IsNullOrWhiteSpace(presetId)
            && await _presets.ExistsAsync(conn, presetId, cancellationToken).ConfigureAwait(false))
        {
            return presetId;
        }

        return FlashcardPreset.StandardPresetId;
    }

    // ---- Material and cards -------------------------------------------------------------------

    private async Task<Dictionary<string, string>> RestoreFactsAsync(
        Microsoft.Data.Sqlite.SqliteConnection conn,
        Microsoft.Data.Sqlite.SqliteTransaction tx,
        FlashcardPayloadSnapshot snapshot,
        ImportConflictPolicy policy,
        IReadOnlyDictionary<string, string> deckMap,
        string imagesDirectory,
        CancellationToken cancellationToken)
    {
        var map = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var fact in snapshot.Facts)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (string.IsNullOrWhiteSpace(fact.Id))
                continue;

            var homeDeckId = await ResolveFactHomeAsync(conn, fact, deckMap, cancellationToken).ConfigureAwait(false);
            if (homeDeckId is null)
                continue;

            var id = fact.Id;
            if (await _facts.GetAsync(conn, id, cancellationToken).ConfigureAwait(false) is not null)
            {
                if (policy == ImportConflictPolicy.Skip)
                {
                    map[fact.Id] = id;
                    continue;
                }

                if (policy == ImportConflictPolicy.KeepBoth)
                    id = NewId();
            }

            map[fact.Id] = id;
            await _facts.UpsertAsync(conn, tx, ToFact(fact, id, homeDeckId, imagesDirectory), cancellationToken).ConfigureAwait(false);
        }

        return map;
    }

    /// <summary>
    /// Which deck a restored fact is filed under. Its own deck when that deck is here, otherwise
    /// the deck one of its cards landed in, so material stays reachable from the card browser
    /// instead of being filed under a deck the package never carried.
    /// </summary>
    private async Task<string?> ResolveFactHomeAsync(
        Microsoft.Data.Sqlite.SqliteConnection conn,
        FactSnapshotDto fact,
        IReadOnlyDictionary<string, string> deckMap,
        CancellationToken cancellationToken)
    {
        if (deckMap.TryGetValue(fact.DeckId, out var mapped))
            return mapped;

        if (!string.IsNullOrWhiteSpace(fact.DeckId)
            && await _decks.GetHeaderAsync(conn, fact.DeckId, cancellationToken).ConfigureAwait(false) is not null)
        {
            return fact.DeckId;
        }

        return deckMap.Values.FirstOrDefault();
    }

    private async Task<Dictionary<string, string>> RestoreCardsAsync(
        Microsoft.Data.Sqlite.SqliteConnection conn,
        Microsoft.Data.Sqlite.SqliteTransaction tx,
        FlashcardPayloadSnapshot snapshot,
        ImportConflictPolicy policy,
        IReadOnlyDictionary<string, string> deckMap,
        IReadOnlyDictionary<string, string> factMap,
        string imagesDirectory,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var map = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var deck in snapshot.Decks)
        {
            if (!deckMap.TryGetValue(deck.Id, out var targetDeckId))
                continue;

            foreach (var card in deck.Cards ?? new List<CardSnapshotDto>())
            {
                cancellationToken.ThrowIfCancellationRequested();
                if (string.IsNullOrWhiteSpace(card.Id))
                    continue;

                var cardId = card.Id;
                if (await _cards.GetAsync(conn, cardId, cancellationToken).ConfigureAwait(false) is not null)
                {
                    if (policy == ImportConflictPolicy.Skip)
                        continue;
                    if (policy == ImportConflictPolicy.KeepBoth)
                        cardId = NewId();
                }

                // Material and the layout it was rendered through travel together or not at all.
                // Every other writer of the pair guarantees that, and a card naming material with
                // no layout would sit outside the unique index that reserves one card per layout,
                // and would be invisible to the material's own count of the cards it has made.
                string? factId = null;
                if (!string.IsNullOrWhiteSpace(card.FactId)
                    && !string.IsNullOrWhiteSpace(card.LayoutKey)
                    && factMap.TryGetValue(card.FactId, out var mappedFact))
                {
                    factId = mappedFact;
                }

                var restored = ToCard(card, cardId, targetDeckId, factId, imagesDirectory, now);
                await _cards.UpsertAsync(conn, tx, restored, cancellationToken).ConfigureAwait(false);
                map[card.Id] = cardId;

                await _schedules.UpsertAsync(conn, tx, ToSchedule(card, cardId, now), cancellationToken).ConfigureAwait(false);
            }
        }

        return map;
    }

    // ---- History ------------------------------------------------------------------------------

    private async Task RestoreHistoryAsync(
        Microsoft.Data.Sqlite.SqliteConnection conn,
        Microsoft.Data.Sqlite.SqliteTransaction tx,
        FlashcardPayloadSnapshot snapshot,
        IReadOnlyDictionary<string, string> deckMap,
        IReadOnlyDictionary<string, string> cardMap,
        CancellationToken cancellationToken)
    {
        foreach (var review in snapshot.Reviews)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (!deckMap.TryGetValue(review.DeckId, out var deckId))
                continue;

            // A review of a card the import skipped still belongs to the deck's history, so it keeps
            // the card id it was answered under rather than being dropped.
            var cardId = cardMap.TryGetValue(review.CardId, out var mapped) ? mapped : review.CardId;
            await _reviews.RestoreAsync(conn, tx, new FlashcardReviewLog(
                Id: review.Id,
                CardId: cardId,
                DeckId: deckId,
                SessionId: review.SessionId,
                Grade: (FlashcardReviewGrade)review.Grade,
                ReviewedAt: review.ReviewedAt,
                ElapsedDays: review.ElapsedDays,
                ScheduledDays: review.ScheduledDays,
                StabilityAfter: review.StabilityAfter,
                DifficultyAfter: review.DifficultyAfter,
                StateBefore: review.StateBefore is { } before ? (FlashcardFsrsState)before : null,
                StateAfter: (FlashcardFsrsState)review.StateAfter,
                Origin: (FlashcardReviewOrigin)review.Origin), cancellationToken).ConfigureAwait(false);
        }

        foreach (var stat in snapshot.DailyStats)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (!deckMap.TryGetValue(stat.DeckId, out var deckId))
                continue;

            await _dailyStats.RestoreAsync(conn, tx,
                new FlashcardDailyStat(deckId, stat.Date, stat.NewIntroduced, stat.ReviewsDone), cancellationToken)
                .ConfigureAwait(false);
        }
    }

    // ---- Snapshot to row ----------------------------------------------------------------------

    private Flashcard ToCard(
        CardSnapshotDto card,
        string cardId,
        string deckId,
        string? factId,
        string imagesDirectory,
        DateTimeOffset now)
    {
        // Convert legacy embedded image tokens into attachment records at the boundary, so no
        // downstream renderer needs the regex again. A package that carries attachments of its own
        // also carried their bytes, so its tokens are only a compatibility copy: strip them and use
        // the field, whose paths are rebuilt against this installation's images directory.
        var conversion = FlashcardImageTokenConverter.Convert(cardId, card.Front, card.Back);
        var carriesAttachments = card.Attachments is { Count: > 0 };
        if (!carriesAttachments)
        {
            foreach (var warning in conversion.Warnings)
                _logger.Warning("Flashcards", warning.Message);
        }

        return new Flashcard(
            Id: cardId,
            DeckId: deckId,
            Type: (FlashcardType)card.Type,
            Front: conversion.CleanFront,
            Back: conversion.CleanBack,
            Tags: card.Tags ?? Array.Empty<string>(),
            State: card.State is { } state ? (FlashcardCardState)state : FlashcardCardState.Active,
            IsFlagged: card.IsFlagged ?? false,
            Attachments: carriesAttachments
                ? ToAttachments(card.Attachments!, imagesDirectory)
                : conversion.Attachments,
            SourceInfo: ToSource(card.SourceInfo),
            FrontBlocks: card.FrontBlocks,
            BackBlocks: card.BackBlocks,
            CreatedAt: card.CreatedAt ?? now,
            UpdatedAt: card.UpdatedAt ?? now,
            FactId: factId,
            LayoutKey: factId is null ? null : card.LayoutKey);
    }

    private static FlashcardSchedule ToSchedule(CardSnapshotDto card, string cardId, DateTimeOffset now) => new(
        CardId: cardId,
        DueDate: card.DueDate == default ? now : card.DueDate,
        Stability: card.Stability,
        Difficulty: card.Difficulty,
        Reps: card.ReviewCount ?? 0,
        Lapses: card.LapseCount ?? 0,
        FsrsState: (FlashcardFsrsState)(card.FsrsState ?? 0),
        LearningStepIndex: card.LearningStepIndex ?? 0,
        LastReviewedAt: card.LastReviewedAt,
        BuriedUntil: card.BuriedUntil);

    private static FlashcardFact ToFact(FactSnapshotDto fact, string id, string deckId, string imagesDirectory)
    {
        var media = new Dictionary<string, IReadOnlyList<FlashcardAttachment>>(StringComparer.Ordinal);
        foreach (var pair in fact.Media ?? new Dictionary<string, List<AttachmentSnapshotDto>>())
        {
            var attachments = ToAttachments(pair.Value, imagesDirectory);
            if (attachments.Count > 0)
                media[pair.Key] = attachments;
        }

        return new FlashcardFact(
            Id: id,
            DeckId: deckId,
            TypeId: string.IsNullOrWhiteSpace(fact.TypeId) ? FlashcardCardType.BasicId : fact.TypeId,
            Values: fact.Values is null
                ? new Dictionary<string, string>(StringComparer.Ordinal)
                : new Dictionary<string, string>(fact.Values, StringComparer.Ordinal),
            Media: media,
            Tags: fact.Tags ?? Array.Empty<string>(),
            IsFlagged: fact.IsFlagged,
            SourceInfo: ToSource(fact.SourceInfo),
            CreatedAt: fact.CreatedAt ?? default,
            UpdatedAt: fact.UpdatedAt ?? default);
    }

    private static FlashcardPreset ToPreset(PresetSnapshotDto preset) => new(
        Id: preset.Id,
        Name: preset.Name,
        NewPerDay: preset.NewPerDay,
        MaxReviewsPerDay: preset.MaxReviewsPerDay,
        Algorithm: (FlashcardSchedulingAlgorithm)preset.Algorithm,
        DesiredRetention: preset.DesiredRetention,
        LearningSteps: preset.LearningSteps ?? new[] { 1, 10 },
        RelearnSteps: preset.RelearnSteps ?? new[] { 10 },
        ShuffleOrder: preset.ShuffleOrder,
        BuryRelated: preset.BuryRelated,
        AutoReveal: (FlashcardAutoReveal)preset.AutoReveal,
        Weights: preset.Weights,
        CreatedAt: preset.CreatedAt ?? default,
        UpdatedAt: preset.UpdatedAt ?? default,
        NextDayStartsAtHour: preset.NextDayStartsAtHour,
        LeechThreshold: preset.LeechThreshold,
        LeechAction: (FlashcardLeechAction)preset.LeechAction);

    private static FlashcardCardType ToCardType(CardTypeSnapshotDto type) => new(
        Id: type.Id,
        Name: type.Name,
        IsBuiltIn: type.IsBuiltIn,
        Fields: (type.Fields ?? new List<FieldSnapshotDto>())
            .Select(f => new FlashcardField(f.Id, f.Name, f.Hint))
            .ToList(),
        SortFieldId: type.SortFieldId,
        Layouts: (type.Layouts ?? new List<LayoutSnapshotDto>())
            .Select(l => new FlashcardLayout(l.Id, l.Name, l.Front, l.Back, l.Requires))
            .ToList(),
        Generator: type.Generator,
        GenerateFrom: type.GenerateFrom,
        CreatedAt: type.CreatedAt ?? default,
        UpdatedAt: type.UpdatedAt ?? default);

    private static FlashcardSourceInfo? ToSource(SourceSnapshotDto? source) =>
        source is { SourceType: { } type, SourceId: { } id }
            ? new FlashcardSourceInfo(type, id, source.DisplayLabel)
            : null;

    /// <summary>
    /// Rebuilds attachment records against this installation's images directory. The packaged file
    /// name is the only part that travels; the path it had on the machine that wrote the package is
    /// meaningless anywhere else.
    /// </summary>
    private static IReadOnlyList<FlashcardAttachment> ToAttachments(
        IReadOnlyList<AttachmentSnapshotDto> snapshots,
        string imagesDirectory)
    {
        var attachments = new List<FlashcardAttachment>(snapshots.Count);
        foreach (var snapshot in snapshots)
        {
            var fileName = Path.GetFileName(snapshot.FileName.Replace('\\', '/'));
            if (string.IsNullOrWhiteSpace(fileName))
                continue;

            attachments.Add(new FlashcardAttachment(
                Id: string.IsNullOrWhiteSpace(snapshot.Id) ? NewId() : snapshot.Id,
                Side: string.Equals(snapshot.Side, FlashcardAttachment.BackSide, StringComparison.OrdinalIgnoreCase)
                    ? FlashcardAttachment.BackSide
                    : FlashcardAttachment.FrontSide,
                FilePath: Path.Combine(imagesDirectory, fileName),
                DisplayName: string.IsNullOrWhiteSpace(snapshot.DisplayName) ? fileName : snapshot.DisplayName,
                SizeBytes: snapshot.SizeBytes,
                Caption: snapshot.Caption));
        }

        return attachments;
    }

    private static string NewId() => Guid.NewGuid().ToString("N");
}
