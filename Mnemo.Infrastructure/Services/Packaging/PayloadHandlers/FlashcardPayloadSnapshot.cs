using Mnemo.Core.Models;

namespace Mnemo.Infrastructure.Services.Packaging.PayloadHandlers;

/// <summary>
/// Everything a flashcards payload carries, in the shape it travels in. One instance is a whole
/// package's worth of collection: what a capture produced, or what a read of a package produced.
/// </summary>
/// <remarks>
/// Names and types are the wire format, so they are frozen once shipped. Fields added after the
/// first release are nullable or default to empty, because a package written by an older build
/// simply does not have them and has to keep importing.
/// </remarks>
internal sealed class FlashcardPayloadSnapshot
{
    public List<FolderSnapshotDto> Folders { get; } = new();

    public List<DeckSnapshotDto> Decks { get; } = new();

    public List<PresetSnapshotDto> Presets { get; } = new();

    public List<CardTypeSnapshotDto> CardTypes { get; } = new();

    public List<FactSnapshotDto> Facts { get; } = new();

    public List<ReviewSnapshotDto> Reviews { get; } = new();

    public List<DailyStatSnapshotDto> DailyStats { get; } = new();
}

internal sealed class FolderSnapshotDto
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? ParentId { get; set; }
    public int Order { get; set; }
}

/// <summary>
/// One deck and the cards standing in it. <see cref="RetentionScore"/> and
/// <see cref="SchedulingAlgorithm"/> are read by builds that predate the relational store and are
/// written for their benefit only.
/// </summary>
internal sealed class DeckSnapshotDto
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? FolderId { get; set; }
    public string? Description { get; set; }
    public string[]? Tags { get; set; }
    public DateTimeOffset? LastStudied { get; set; }
    public int RetentionScore { get; set; }
    public List<CardSnapshotDto>? Cards { get; set; }
    public int SchedulingAlgorithm { get; set; }

    /// <summary>
    /// The scheduling profile the deck was bound to. Null in a package written before presets
    /// travelled, which is why an import falls back to the shared standard preset rather than
    /// treating a missing value as a deck with no profile.
    /// </summary>
    public string? PresetId { get; set; }

    public string? Icon { get; set; }
    public int SortOrder { get; set; }
    public DateTimeOffset? CreatedAt { get; set; }
    public DateTimeOffset? UpdatedAt { get; set; }
}

internal sealed class CardSnapshotDto
{
    public string Id { get; set; } = string.Empty;
    public string DeckId { get; set; } = string.Empty;
    public string? Front { get; set; }
    public string? Back { get; set; }
    public int Type { get; set; }
    public string[]? Tags { get; set; }
    public DateTimeOffset DueDate { get; set; }
    public double? Stability { get; set; }
    public double? Difficulty { get; set; }
    public double? Retrievability { get; set; }
    public SourceSnapshotDto? SourceInfo { get; set; }
    public IReadOnlyList<Block>? FrontBlocks { get; set; }
    public IReadOnlyList<Block>? BackBlocks { get; set; }
    public int? ReviewCount { get; set; }
    public int? LapseCount { get; set; }
    public int? LeitnerBox { get; set; }
    public DateTimeOffset? LastReviewedAt { get; set; }
    public int? FsrsState { get; set; }
    public List<AttachmentSnapshotDto>? Attachments { get; set; }
    public int? State { get; set; }
    public bool? IsFlagged { get; set; }

    /// <summary>
    /// The material this card renders, and which of that material's cards it is. Without both, a
    /// cloze fact's cards come back as unrelated freeform cards and the fact behind them is lost.
    /// </summary>
    public string? FactId { get; set; }

    public string? LayoutKey { get; set; }

    /// <summary>Where the card sits in its preset's learning steps. Zero in an older package.</summary>
    public int? LearningStepIndex { get; set; }

    public DateTimeOffset? BuriedUntil { get; set; }
    public DateTimeOffset? CreatedAt { get; set; }
    public DateTimeOffset? UpdatedAt { get; set; }
}

/// <summary>
/// One card image. The file name is the entry the bytes travel under, never a machine-specific
/// path: a restore rebuilds the path from wherever this installation keeps its images.
/// </summary>
internal sealed class AttachmentSnapshotDto
{
    public string Id { get; set; } = string.Empty;
    public string Side { get; set; } = string.Empty;
    public string FileName { get; set; } = string.Empty;
    public string? DisplayName { get; set; }
    public long SizeBytes { get; set; }
    public string? Caption { get; set; }
}

internal sealed class SourceSnapshotDto
{
    public string? SourceType { get; set; }
    public string? SourceId { get; set; }
    public string? DisplayLabel { get; set; }
}

/// <summary>A scheduling profile, with the FSRS weights and limits a deck was actually studied under.</summary>
internal sealed class PresetSnapshotDto
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public int NewPerDay { get; set; }
    public int MaxReviewsPerDay { get; set; }
    public int Algorithm { get; set; }
    public double DesiredRetention { get; set; }
    public int[]? LearningSteps { get; set; }
    public int[]? RelearnSteps { get; set; }
    public bool ShuffleOrder { get; set; }
    public bool BuryRelated { get; set; }
    public int AutoReveal { get; set; }
    public double[]? Weights { get; set; }
    public int NextDayStartsAtHour { get; set; }
    public int LeechThreshold { get; set; }
    public int LeechAction { get; set; }
    public DateTimeOffset? CreatedAt { get; set; }
    public DateTimeOffset? UpdatedAt { get; set; }
}

/// <summary>A card type: the fields material can fill and the layouts that turn them into cards.</summary>
internal sealed class CardTypeSnapshotDto
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public bool IsBuiltIn { get; set; }
    public List<FieldSnapshotDto>? Fields { get; set; }
    public string SortFieldId { get; set; } = string.Empty;
    public List<LayoutSnapshotDto>? Layouts { get; set; }
    public string? Generator { get; set; }
    public string? GenerateFrom { get; set; }
    public DateTimeOffset? CreatedAt { get; set; }
    public DateTimeOffset? UpdatedAt { get; set; }
}

internal sealed class FieldSnapshotDto
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? Hint { get; set; }
}

internal sealed class LayoutSnapshotDto
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Front { get; set; } = string.Empty;
    public string Back { get; set; } = string.Empty;
    public string? Requires { get; set; }
}

/// <summary>One filling in of a card type: the authored content every card of it renders.</summary>
internal sealed class FactSnapshotDto
{
    public string Id { get; set; } = string.Empty;
    public string DeckId { get; set; } = string.Empty;
    public string TypeId { get; set; } = string.Empty;
    public Dictionary<string, string>? Values { get; set; }
    public Dictionary<string, List<AttachmentSnapshotDto>>? Media { get; set; }
    public string[]? Tags { get; set; }
    public bool IsFlagged { get; set; }
    public SourceSnapshotDto? SourceInfo { get; set; }
    public DateTimeOffset? CreatedAt { get; set; }
    public DateTimeOffset? UpdatedAt { get; set; }
}

/// <summary>One answered card, as the append only review log recorded it.</summary>
internal sealed class ReviewSnapshotDto
{
    public long Id { get; set; }
    public string CardId { get; set; } = string.Empty;
    public string DeckId { get; set; } = string.Empty;
    public string SessionId { get; set; } = string.Empty;
    public int Grade { get; set; }
    public DateTimeOffset ReviewedAt { get; set; }
    public double ElapsedDays { get; set; }
    public double ScheduledDays { get; set; }
    public double? StabilityAfter { get; set; }
    public double? DifficultyAfter { get; set; }
    public int? StateBefore { get; set; }
    public int StateAfter { get; set; }

    /// <summary>
    /// Whether the answer was given here or carried in from another app. Absent from a package
    /// written before the distinction was recorded, which reads back as zero, and zero is answered
    /// here: exactly what every review in such a package was.
    /// </summary>
    public int Origin { get; set; }
}

/// <summary>One study day's counters for a deck, which is what the activity and streak read.</summary>
internal sealed class DailyStatSnapshotDto
{
    public string DeckId { get; set; } = string.Empty;
    public string Date { get; set; } = string.Empty;
    public int NewIntroduced { get; set; }
    public int ReviewsDone { get; set; }
}
