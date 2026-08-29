using Mnemo.Core.Models;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.Flashcards.Persistence;

namespace Mnemo.Infrastructure.Services.Packaging.PayloadHandlers;

/// <summary>
/// Reads a collection into the snapshot a <c>.mnemo</c> package carries.
/// </summary>
/// <remarks>
/// Everything is read through the live paths, so content the trash is holding stays out of a
/// package. What is taken depends on what the package is for: an export carries the chosen decks
/// with the material and profiles they need to be usable somewhere else, while a backup also
/// carries every profile and card type in the collection plus the review history and daily
/// counters, which are the person's own record and have no business travelling to anybody else.
/// </remarks>
internal sealed class FlashcardCollectionCapture
{
    private const int CardPageSize = 200;

    private readonly IFlashcardLibraryService _library;
    private readonly IFlashcardCardService _cards;
    private readonly IFlashcardStore _store;
    private readonly IPresetRepository _presets;
    private readonly ICardTypeRepository _cardTypes;
    private readonly IFactRepository _facts;
    private readonly IReviewRepository _reviews;
    private readonly IDailyStatsRepository _dailyStats;

    public FlashcardCollectionCapture(
        IFlashcardLibraryService library,
        IFlashcardCardService cards,
        IFlashcardStore store,
        IPresetRepository presets,
        ICardTypeRepository cardTypes,
        IFactRepository facts,
        IReviewRepository reviews,
        IDailyStatsRepository dailyStats)
    {
        _library = library;
        _cards = cards;
        _store = store;
        _presets = presets;
        _cardTypes = cardTypes;
        _facts = facts;
        _reviews = reviews;
        _dailyStats = dailyStats;
    }

    /// <summary>What a capture produced: the snapshot, plus the image files it refers to.</summary>
    public sealed record Result(FlashcardPayloadSnapshot Snapshot, IReadOnlyList<string> AttachmentPaths);

    public async Task<Result> CaptureAsync(
        MnemoPackageExportOptions options,
        CancellationToken cancellationToken)
    {
        var isBackup = MnemoPackageKinds.IsBackup(options.Kind);
        var selectedDeckIds = ResolveSelectedDeckIds(options);

        var folders = await _library.ListFoldersAsync(cancellationToken).ConfigureAwait(false);
        var summaries = await _library.ListDecksAsync(cancellationToken).ConfigureAwait(false);
        if (selectedDeckIds.Count > 0)
        {
            summaries = summaries.Where(d => selectedDeckIds.Contains(d.Id)).ToArray();
            var usedFolderIds = new HashSet<string>(
                summaries.Where(d => !string.IsNullOrWhiteSpace(d.Header.FolderId)).Select(d => d.Header.FolderId!),
                StringComparer.Ordinal);
            folders = folders.Where(f => usedFolderIds.Contains(f.Id)).ToArray();
        }

        var snapshot = new FlashcardPayloadSnapshot();
        var attachmentPaths = new List<string>();

        snapshot.Folders.AddRange(folders.Select(f => new FolderSnapshotDto
        {
            Id = f.Id,
            Name = f.Name,
            ParentId = f.ParentId,
            Order = f.Order,
        }));

        var deckIds = new List<string>(summaries.Count);
        foreach (var summary in summaries)
        {
            cancellationToken.ThrowIfCancellationRequested();
            deckIds.Add(summary.Id);
            snapshot.Decks.Add(await BuildDeckAsync(summary, attachmentPaths, cancellationToken).ConfigureAwait(false));
        }

        await AddFactsAsync(snapshot, deckIds, attachmentPaths, cancellationToken).ConfigureAwait(false);
        await AddPresetsAndTypesAsync(snapshot, isBackup, cancellationToken).ConfigureAwait(false);

        if (isBackup)
            await AddHistoryAsync(snapshot, deckIds, cancellationToken).ConfigureAwait(false);

        return new Result(snapshot, attachmentPaths);
    }

    private async Task<DeckSnapshotDto> BuildDeckAsync(
        FlashcardDeckSummary summary,
        ICollection<string> attachmentPaths,
        CancellationToken cancellationToken)
    {
        var header = summary.Header;
        var cards = new List<CardSnapshotDto>();
        var offset = 0;
        while (true)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var page = await _cards.ListCardsAsync(
                new FlashcardCardQuery(header.Id, Offset: offset, Limit: CardPageSize),
                cancellationToken).ConfigureAwait(false);
            foreach (var view in page.Items)
                cards.Add(ToCard(view, attachmentPaths));

            offset += page.Items.Count;
            if (page.Items.Count == 0 || offset >= page.TotalCount)
                break;
        }

        return new DeckSnapshotDto
        {
            Id = header.Id,
            Name = header.Name,
            FolderId = header.FolderId,
            Description = header.Description,
            Tags = header.Tags?.ToArray() ?? Array.Empty<string>(),
            LastStudied = header.LastStudied,
            RetentionScore = summary.RetentionPercent,
            Cards = cards,
            SchedulingAlgorithm = (int)FlashcardSchedulingAlgorithm.Fsrs,
            PresetId = header.PresetId,
            Icon = header.Icon,
            SortOrder = header.SortOrder,
            CreatedAt = header.CreatedAt,
            UpdatedAt = header.UpdatedAt,
        };
    }

    private static CardSnapshotDto ToCard(FlashcardView view, ICollection<string> attachmentPaths)
    {
        var card = view.Card;
        var schedule = view.Schedule;

        return new CardSnapshotDto
        {
            Id = card.Id,
            DeckId = card.DeckId,
            // The inline `![alt](path){align=...}` tokens stay in the text for builds that predate
            // the attachment field, which read a package's images only from there. A build that
            // understands the field strips the tokens and uses the field instead.
            Front = EmbedAttachmentsAsTokens(card.Front, card.Attachments, FlashcardAttachment.FrontSide),
            Back = EmbedAttachmentsAsTokens(card.Back, card.Attachments, FlashcardAttachment.BackSide),
            Attachments = ToAttachments(card.Attachments, attachmentPaths),
            State = (int)card.State,
            IsFlagged = card.IsFlagged,
            Type = (int)card.Type,
            Tags = card.Tags?.ToArray() ?? Array.Empty<string>(),
            DueDate = schedule.DueDate,
            Stability = schedule.Stability,
            Difficulty = schedule.Difficulty,
            Retrievability = null,
            SourceInfo = ToSource(card.SourceInfo),
            FrontBlocks = card.FrontBlocks,
            BackBlocks = card.BackBlocks,
            ReviewCount = schedule.Reps,
            LapseCount = schedule.Lapses,
            LeitnerBox = null,
            LastReviewedAt = schedule.LastReviewedAt,
            FsrsState = (int)schedule.FsrsState,
            FactId = card.FactId,
            LayoutKey = card.LayoutKey,
            LearningStepIndex = schedule.LearningStepIndex,
            BuriedUntil = schedule.BuriedUntil,
            CreatedAt = card.CreatedAt,
            UpdatedAt = card.UpdatedAt,
        };
    }

    /// <summary>
    /// Every fact the captured decks own, plus any fact a captured card was made from that lives
    /// somewhere else. Without the second half, exporting one deck of a collection would carry
    /// cards whose material is nowhere in the package, and they would restore as freeform text.
    /// </summary>
    private async Task AddFactsAsync(
        FlashcardPayloadSnapshot snapshot,
        IReadOnlyList<string> deckIds,
        ICollection<string> attachmentPaths,
        CancellationToken cancellationToken)
    {
        var captured = new Dictionary<string, FlashcardFact>(StringComparer.Ordinal);
        await _store.ReadAsync(async (conn, ct) =>
        {
            foreach (var deckId in deckIds)
            {
                foreach (var fact in await _facts.ListByDeckAsync(conn, deckId, ct).ConfigureAwait(false))
                    captured[fact.Id] = fact;
            }

            var referenced = snapshot.Decks
                .SelectMany(d => d.Cards ?? new List<CardSnapshotDto>())
                .Select(c => c.FactId)
                .Where(id => !string.IsNullOrWhiteSpace(id))
                .Select(id => id!)
                .Distinct(StringComparer.Ordinal);

            foreach (var factId in referenced)
            {
                if (captured.ContainsKey(factId))
                    continue;
                if (await _facts.GetAsync(conn, factId, ct).ConfigureAwait(false) is { } fact)
                    captured[fact.Id] = fact;
            }

            return true;
        }, cancellationToken).ConfigureAwait(false);

        foreach (var fact in captured.Values)
            snapshot.Facts.Add(ToFact(fact, attachmentPaths));
    }

    private async Task AddPresetsAndTypesAsync(
        FlashcardPayloadSnapshot snapshot,
        bool isBackup,
        CancellationToken cancellationToken)
    {
        var neededPresets = new HashSet<string>(
            snapshot.Decks.Select(d => d.PresetId).Where(id => !string.IsNullOrWhiteSpace(id)).Select(id => id!),
            StringComparer.Ordinal);
        var neededTypes = new HashSet<string>(
            snapshot.Facts.Select(f => f.TypeId).Where(id => !string.IsNullOrWhiteSpace(id)),
            StringComparer.Ordinal);

        await _store.ReadAsync(async (conn, ct) =>
        {
            foreach (var preset in await _presets.ListAsync(conn, ct).ConfigureAwait(false))
            {
                if (isBackup || neededPresets.Contains(preset.Id))
                    snapshot.Presets.Add(ToPreset(preset));
            }

            foreach (var type in await _cardTypes.ListAsync(conn, ct).ConfigureAwait(false))
            {
                if (isBackup || neededTypes.Contains(type.Id))
                    snapshot.CardTypes.Add(ToCardType(type));
            }

            return true;
        }, cancellationToken).ConfigureAwait(false);
    }

    private async Task AddHistoryAsync(
        FlashcardPayloadSnapshot snapshot,
        IReadOnlyList<string> deckIds,
        CancellationToken cancellationToken)
    {
        await _store.ReadAsync(async (conn, ct) =>
        {
            foreach (var deckId in deckIds)
            {
                foreach (var review in await _reviews.ListAllForDeckAsync(conn, deckId, ct).ConfigureAwait(false))
                    snapshot.Reviews.Add(ToReview(review));

                foreach (var stat in await _dailyStats.ListAllForDeckAsync(conn, deckId, ct).ConfigureAwait(false))
                {
                    snapshot.DailyStats.Add(new DailyStatSnapshotDto
                    {
                        DeckId = stat.DeckId,
                        Date = stat.Date,
                        NewIntroduced = stat.NewIntroduced,
                        ReviewsDone = stat.ReviewsDone,
                    });
                }
            }

            return true;
        }, cancellationToken).ConfigureAwait(false);
    }

    // ---- Row to snapshot -------------------------------------------------------------------------

    private static FactSnapshotDto ToFact(FlashcardFact fact, ICollection<string> attachmentPaths)
    {
        var media = new Dictionary<string, List<AttachmentSnapshotDto>>(StringComparer.Ordinal);
        foreach (var pair in fact.Media)
        {
            var snapshots = ToAttachments(pair.Value, attachmentPaths);
            if (snapshots.Count > 0)
                media[pair.Key] = snapshots;
        }

        return new FactSnapshotDto
        {
            Id = fact.Id,
            DeckId = fact.DeckId,
            TypeId = fact.TypeId,
            Values = new Dictionary<string, string>(fact.Values, StringComparer.Ordinal),
            Media = media,
            Tags = fact.Tags?.ToArray() ?? Array.Empty<string>(),
            IsFlagged = fact.IsFlagged,
            SourceInfo = ToSource(fact.SourceInfo),
            CreatedAt = fact.CreatedAt,
            UpdatedAt = fact.UpdatedAt,
        };
    }

    private static PresetSnapshotDto ToPreset(FlashcardPreset preset) => new()
    {
        Id = preset.Id,
        Name = preset.Name,
        NewPerDay = preset.NewPerDay,
        MaxReviewsPerDay = preset.MaxReviewsPerDay,
        Algorithm = (int)preset.Algorithm,
        DesiredRetention = preset.DesiredRetention,
        LearningSteps = preset.LearningSteps?.ToArray(),
        RelearnSteps = preset.RelearnSteps?.ToArray(),
        ShuffleOrder = preset.ShuffleOrder,
        BuryRelated = preset.BuryRelated,
        AutoReveal = (int)preset.AutoReveal,
        Weights = preset.Weights?.ToArray(),
        NextDayStartsAtHour = preset.NextDayStartsAtHour,
        LeechThreshold = preset.LeechThreshold,
        LeechAction = (int)preset.LeechAction,
        CreatedAt = preset.CreatedAt,
        UpdatedAt = preset.UpdatedAt,
    };

    private static CardTypeSnapshotDto ToCardType(FlashcardCardType type) => new()
    {
        Id = type.Id,
        Name = type.Name,
        IsBuiltIn = type.IsBuiltIn,
        Fields = type.Fields.Select(f => new FieldSnapshotDto { Id = f.Id, Name = f.Name, Hint = f.Hint }).ToList(),
        SortFieldId = type.SortFieldId,
        Layouts = type.Layouts
            .Select(l => new LayoutSnapshotDto { Id = l.Id, Name = l.Name, Front = l.Front, Back = l.Back, Requires = l.Requires })
            .ToList(),
        Generator = type.Generator,
        GenerateFrom = type.GenerateFrom,
        CreatedAt = type.CreatedAt,
        UpdatedAt = type.UpdatedAt,
    };

    private static ReviewSnapshotDto ToReview(FlashcardReviewLog log) => new()
    {
        Id = log.Id,
        CardId = log.CardId,
        DeckId = log.DeckId,
        SessionId = log.SessionId,
        Grade = (int)log.Grade,
        ReviewedAt = log.ReviewedAt,
        ElapsedDays = log.ElapsedDays,
        ScheduledDays = log.ScheduledDays,
        StabilityAfter = log.StabilityAfter,
        DifficultyAfter = log.DifficultyAfter,
        StateBefore = log.StateBefore is { } before ? (int)before : null,
        StateAfter = (int)log.StateAfter,
        Origin = (int)log.Origin,
    };

    private static SourceSnapshotDto? ToSource(FlashcardSourceInfo? source) =>
        source is { } s ? new SourceSnapshotDto { SourceType = s.SourceType, SourceId = s.SourceId, DisplayLabel = s.DisplayLabel } : null;

    private static List<AttachmentSnapshotDto> ToAttachments(
        IReadOnlyList<FlashcardAttachment>? attachments,
        ICollection<string> attachmentPaths)
    {
        var snapshots = new List<AttachmentSnapshotDto>();
        foreach (var attachment in attachments ?? Array.Empty<FlashcardAttachment>())
        {
            var fileName = Path.GetFileName(attachment.FilePath);
            if (string.IsNullOrWhiteSpace(fileName))
                continue;

            attachmentPaths.Add(attachment.FilePath);
            snapshots.Add(new AttachmentSnapshotDto
            {
                Id = attachment.Id,
                Side = attachment.Side,
                FileName = fileName,
                DisplayName = attachment.DisplayName,
                SizeBytes = attachment.SizeBytes,
                Caption = attachment.Caption,
            });
        }

        return snapshots;
    }

    /// <summary>
    /// Appends filename-only image tokens for older readers. Absolute paths would disclose the
    /// exporting account and fail on other machines. Attachments without filenames are skipped.
    /// </summary>
    private static string EmbedAttachmentsAsTokens(string text, IReadOnlyList<FlashcardAttachment>? attachments, string side)
    {
        if (attachments is null || attachments.Count == 0)
            return text;

        var tokens = attachments
            .Where(a => string.Equals(a.Side, side, StringComparison.OrdinalIgnoreCase))
            .Select(a => new { a.Caption, FileName = Path.GetFileName(a.FilePath.Replace('\\', '/')) })
            .Where(a => !string.IsNullOrWhiteSpace(a.FileName))
            .Select(a => $"![{a.Caption ?? string.Empty}]({a.FileName})")
            .ToArray();
        if (tokens.Length == 0)
            return text;

        var suffix = string.Join("\n", tokens);
        return string.IsNullOrEmpty(text) ? suffix : $"{text}\n\n{suffix}";
    }

    private static HashSet<string> ResolveSelectedDeckIds(MnemoPackageExportOptions options)
    {
        if (!options.PayloadOptions.TryGetValue("flashcards.deckIds", out var value))
            return new HashSet<string>(StringComparer.Ordinal);
        if (value is IEnumerable<string> ids)
            return new HashSet<string>(ids.Where(v => !string.IsNullOrWhiteSpace(v)), StringComparer.Ordinal);
        return new HashSet<string>(StringComparer.Ordinal);
    }
}
