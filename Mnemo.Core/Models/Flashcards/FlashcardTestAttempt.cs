namespace Mnemo.Core.Models.Flashcards;

/// <summary>
/// One completed Test attempt. Test is isolated from FSRS — it writes only here and never touches
/// scheduling or retention. Feeds the Test stats bucket (score, "better than last time", trend).
/// </summary>
public sealed record FlashcardTestAttempt(
    string Id,
    string DeckId,
    DateTimeOffset StartedAt,
    DateTimeOffset CompletedAt,
    int CardsTested,
    int GotItCount,
    int CloseCount,
    int MissedCount,
    double ScorePct);
