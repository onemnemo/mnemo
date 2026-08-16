namespace Mnemo.Core.Models.Flashcards;

/// <summary>
/// A shared scheduling profile. A deck references exactly one preset; editing a preset changes
/// scheduling for every deck bound to it. Owns the algorithm, retention target, daily limits,
/// learning steps and session behaviour.
/// </summary>
public sealed record FlashcardPreset(
    string Id,
    string Name,
    int NewPerDay,
    int MaxReviewsPerDay,
    FlashcardSchedulingAlgorithm Algorithm,
    double DesiredRetention,
    IReadOnlyList<int> LearningSteps,
    IReadOnlyList<int> RelearnSteps,
    bool ShuffleOrder,
    bool BuryRelated,
    FlashcardAutoReveal AutoReveal,
    IReadOnlyList<double>? Weights = null,
    DateTimeOffset CreatedAt = default,
    DateTimeOffset UpdatedAt = default)
{
    /// <summary>Id of the seeded default preset that every legacy deck is attached to on migration.</summary>
    public const string StandardPresetId = "preset-standard";

    /// <summary>Builds the default "Standard" preset with FSRS-6 defaults.</summary>
    public static FlashcardPreset CreateStandard(DateTimeOffset now) => new(
        Id: StandardPresetId,
        Name: "Standard",
        NewPerDay: 20,
        MaxReviewsPerDay: 200,
        Algorithm: FlashcardSchedulingAlgorithm.Fsrs,
        DesiredRetention: 0.9,
        LearningSteps: new[] { 1, 10 },
        RelearnSteps: new[] { 10 },
        ShuffleOrder: false,
        BuryRelated: true,
        AutoReveal: FlashcardAutoReveal.Off,
        Weights: null,
        CreatedAt: now,
        UpdatedAt: now);
}
