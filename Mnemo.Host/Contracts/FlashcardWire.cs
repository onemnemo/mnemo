using Mnemo.Core.Models.Flashcards;

namespace Mnemo.Host.Contracts;

/// <summary>
/// Flashcard enum &lt;-&gt; wire-token mapping.
/// </summary>
/// <remarks>
/// The host configures no JSON options, so an enum-typed DTO property would serialize as
/// its integer value and reordering an enum member would silently change the API. Every
/// flashcard enum crosses as an explicit lowercase token instead, which also lets the
/// TypeScript mirror express them as string-literal unions.
/// </remarks>
public static class FlashcardWire
{
    public static string Type(FlashcardType value) => value switch
    {
        FlashcardType.Cloze => "cloze",
        _ => "classic",
    };

    public static FlashcardType ParseType(string? value) =>
        string.Equals(value, "cloze", StringComparison.OrdinalIgnoreCase)
            ? FlashcardType.Cloze
            : FlashcardType.Classic;

    public static string CardState(FlashcardCardState value) => value switch
    {
        FlashcardCardState.Suspended => "suspended",
        _ => "active",
    };

    public static string FsrsState(FlashcardFsrsState value) => value switch
    {
        FlashcardFsrsState.Learning => "learning",
        FlashcardFsrsState.Review => "review",
        FlashcardFsrsState.Relearning => "relearning",
        _ => "new",
    };

    public static string SessionMode(FlashcardSessionMode value) => value switch
    {
        FlashcardSessionMode.Cram => "cram",
        FlashcardSessionMode.Test => "test",
        _ => "review",
    };

    public static string SessionScope(FlashcardSessionScope value) => value switch
    {
        FlashcardSessionScope.All => "all",
        _ => "due",
    };

    public static string AutoReveal(FlashcardAutoReveal value) => value switch
    {
        FlashcardAutoReveal.FiveSeconds => "five-seconds",
        FlashcardAutoReveal.TenSeconds => "ten-seconds",
        _ => "off",
    };

    /// <summary>
    /// Strict, unlike the filter parsers below: an unrecognized mode has no sensible default,
    /// since silently starting a Review for a client that asked for a Cram would write the
    /// schedule it expected to be left alone.
    /// </summary>
    public static bool TryParseSessionMode(string? value, out FlashcardSessionMode mode)
    {
        switch (value?.ToLowerInvariant())
        {
            case "review": mode = FlashcardSessionMode.Review; return true;
            case "cram": mode = FlashcardSessionMode.Cram; return true;
            case "test": mode = FlashcardSessionMode.Test; return true;
            default: mode = FlashcardSessionMode.Review; return false;
        }
    }

    public static FlashcardSessionScope ParseSessionScope(string? value) =>
        string.Equals(value, "all", StringComparison.OrdinalIgnoreCase)
            ? FlashcardSessionScope.All
            : FlashcardSessionScope.Due;

    /// <summary>Strict for the same reason as the mode: a mis-parsed grade rewrites a schedule.</summary>
    public static bool TryParseGrade(string? value, out FlashcardReviewGrade grade)
    {
        switch (value?.ToLowerInvariant())
        {
            case "again": grade = FlashcardReviewGrade.Again; return true;
            case "hard": grade = FlashcardReviewGrade.Hard; return true;
            case "good": grade = FlashcardReviewGrade.Good; return true;
            case "easy": grade = FlashcardReviewGrade.Easy; return true;
            default: grade = FlashcardReviewGrade.Good; return false;
        }
    }

    // Unrecognized filter and sort tokens fall back to the default rather than failing the
    // request, the way the model catalog treats ?scope=. A stale bookmark or a token from a
    // newer build should still render the deck instead of erroring the whole page.
    public static FlashcardCardStateFilter ParseStateFilter(string? value) => value?.ToLowerInvariant() switch
    {
        "due" => FlashcardCardStateFilter.Due,
        "new" => FlashcardCardStateFilter.New,
        "learning" => FlashcardCardStateFilter.Learning,
        "suspended" => FlashcardCardStateFilter.Suspended,
        "flagged" => FlashcardCardStateFilter.Flagged,
        _ => FlashcardCardStateFilter.All,
    };

    public static FlashcardCardSort ParseSort(string? value) => value?.ToLowerInvariant() switch
    {
        "front" => FlashcardCardSort.Front,
        "type" => FlashcardCardSort.Type,
        "reps" => FlashcardCardSort.Reps,
        "lapses" => FlashcardCardSort.Lapses,
        "created" => FlashcardCardSort.Created,
        _ => FlashcardCardSort.Due,
    };
}
