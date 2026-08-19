using Mnemo.Core.Models.Flashcards;

namespace Mnemo.Host.Contracts;

/// <summary>
/// A shared scheduling preset. Hand-mirrored in <c>mnemo-web/src/api/types.ts</c>; the C# side
/// is authoritative.
/// </summary>
/// <remarks>
/// <see cref="DeckCount"/> is not on the domain model - it is counted per preset so the settings
/// sidebar can say "4 decks" without a request per row, and because it is what decides whether a
/// preset may be deleted.
/// </remarks>
public sealed record PresetDto(
    string Id,
    string Name,
    int NewPerDay,
    int MaxReviewsPerDay,
    string Algorithm,
    double DesiredRetention,
    IReadOnlyList<int> LearningSteps,
    bool ShuffleOrder,
    bool BuryRelated,
    string AutoReveal,
    int NextDayStartsAtHour,
    int LeechThreshold,
    string LeechAction,
    int DeckCount,
    bool IsStandard,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt)
{
    public static PresetDto FromModel(FlashcardPreset model, int deckCount)
        => new(
            model.Id,
            model.Name,
            model.NewPerDay,
            model.MaxReviewsPerDay,
            FlashcardWire.SchedulingAlgorithm(model.Algorithm),
            model.DesiredRetention,
            model.LearningSteps,
            model.ShuffleOrder,
            model.BuryRelated,
            FlashcardWire.AutoReveal(model.AutoReveal),
            model.DayStartHour,
            model.LeechLapses,
            FlashcardWire.LeechAction(model.LeechAction),
            deckCount,
            string.Equals(model.Id, FlashcardPreset.StandardPresetId, StringComparison.Ordinal),
            model.CreatedAt,
            model.UpdatedAt);
}

/// <summary>
/// The editable half of a preset, sent by the review settings dialog on create and update.
/// </summary>
/// <remarks>
/// Deliberately smaller than <see cref="PresetDto"/>. Relearn steps, FSRS weights and the
/// algorithm have no editor, and the id and timestamps belong to the server - a client that
/// could name them could overwrite a preset by guessing an id, since the store upserts. Fields
/// left out here are carried forward from the stored preset on update, and seeded from the
/// Standard defaults on create.
/// </remarks>
public sealed record SavePresetDto(
    string Name,
    int NewPerDay,
    int MaxReviewsPerDay,
    double DesiredRetention,
    IReadOnlyList<int> LearningSteps,
    bool ShuffleOrder,
    bool BuryRelated,
    string AutoReveal,
    // Optional so a client that predates the setting keeps the stored hour instead of sending
    // nothing and having it read as midnight. The leech pair is optional for the same reason: a
    // missing threshold would read as zero and a missing action as None, either of which changes
    // the preset without anyone asking.
    int? NextDayStartsAtHour = null,
    int? LeechThreshold = null,
    string? LeechAction = null);

/// <summary>Re-binds a deck to a preset. Sent by the dialog when it was opened from a deck.</summary>
public sealed record AssignPresetDto(string PresetId);
