namespace Mnemo.Core.Models.Flashcards;

/// <summary>
/// Where a row in the review log came from.
/// </summary>
/// <remarks>
/// Persisted as a number, so this is append only: inserting a member renumbers every value after
/// it in real user data. An imported answer counts towards retention and trains the scheduler
/// exactly like one given here, because it describes the same act of remembering. The marker is
/// kept so a later analytics pass can tell the two apart without a second migration.
/// </remarks>
public enum FlashcardReviewOrigin
{
    /// <summary>Answered here, in a scheduled review.</summary>
    Studied = 0,

    /// <summary>Carried in from another app's history rather than answered here.</summary>
    Imported = 1,
}

/// <summary>
/// The synthetic session imported history is grouped under.
/// </summary>
/// <remarks>
/// A review row names the session it was answered in, and imported rows were never answered in
/// one. Rather than leaving the column empty or borrowing a real session's id, every row an import
/// writes shares one id minted for that import, so the rows a single package brought in can be
/// found together and told apart from any sitting beside them.
/// </remarks>
public static class FlashcardImportedReviews
{
    /// <summary>What every synthetic session id starts with.</summary>
    public const string SessionPrefix = "imported-";

    /// <summary>A fresh session id for one import run.</summary>
    public static string NewSessionId() => SessionPrefix + Guid.NewGuid().ToString("N");

    /// <summary>Whether a session id is one of the synthetic ones.</summary>
    public static bool IsImportedSession(string? sessionId) =>
        sessionId is not null && sessionId.StartsWith(SessionPrefix, StringComparison.Ordinal);
}
