using Microsoft.AspNetCore.Http;
using Mnemo.Core.Models.Flashcards;
using Mnemo.Host.Contracts;

namespace Mnemo.Host.Flashcards;

/// <summary>
/// Length checks shared by every flashcards endpoint that takes free text. Names, descriptions
/// and card content are rejected outright when they run over the cap, the same way an empty name
/// already is; tags are trimmed and capped rather than rejected, matching how an empty tag is
/// already dropped rather than failing the whole request.
/// </summary>
internal static class FlashcardTextValidation
{
    /// <summary>True when <paramref name="value"/> runs past <paramref name="maxLength"/>, with the response to send.</summary>
    public static bool TooLong(string value, int maxLength, string code, string field, out IResult error)
    {
        if (value.Length <= maxLength)
        {
            error = Results.Empty;
            return false;
        }

        error = Results.BadRequest(new ErrorDto(code, $"{field} must be {maxLength} characters or fewer."));
        return true;
    }

    /// <summary>Trims, drops the empty ones, and caps what is left at <see cref="FlashcardTextLimits.MaxTagLength"/>.</summary>
    public static IReadOnlyList<string> NormalizeTags(IReadOnlyList<string>? tags) =>
        tags is null
            ? Array.Empty<string>()
            : tags
                .Select(t => t?.Trim() ?? string.Empty)
                .Where(t => t.Length > 0)
                .Select(t => t.Length > FlashcardTextLimits.MaxTagLength ? t[..FlashcardTextLimits.MaxTagLength] : t)
                .ToArray();
}
