using System.Globalization;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Mnemo.Core.Models.Proofing;
using Mnemo.Core.Services.Proofing;
using Mnemo.Host.Contracts;

namespace Mnemo.Host.Proofing;

/// <summary>
/// The two lists of words the user adds to: the personal dictionary, which holds for everything they
/// write, and one note's ignore list, which holds for that note alone.
/// <para>
/// Both are stored as a single settings value rewritten in full on every write, which is where the
/// word length and per note caps come from, and why neither is reachable through the generic
/// settings endpoint.
/// </para>
/// </summary>
internal static class ProofingWordListEndpoints
{
    internal static void MapProofingWordLists(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/api/proofing/personal", async (
            IPersonalDictionaryService personal,
            CancellationToken cancellationToken) =>
            await PersonalWordsAsync(personal, cancellationToken).ConfigureAwait(false));

        endpoints.MapPost("/api/proofing/personal", async (
            ProofingPersonalWordRequestDto? body,
            IPersonalDictionaryService personal,
            CancellationToken cancellationToken) =>
        {
            if (BadWordOrNull(body?.Word) is { } invalid)
                return invalid;

            var outcome = await personal.AddAsync(body!.Word!, body.Language, cancellationToken).ConfigureAwait(false);
            if (RefusedAddOrNull(outcome, personal.MaxWords) is { } refused)
                return refused;

            return await PersonalWordsAsync(personal, cancellationToken, outcome).ConfigureAwait(false);
        });

        // A removal is a POST with the word in the body rather than a DELETE with it in the path.
        // Personal words are exactly the ones a dictionary lacks, so they carry accents, apostrophes
        // and trailing dots, all of which a route segment either rejects or silently decodes twice.
        endpoints.MapPost("/api/proofing/personal/remove", async (
            ProofingPersonalWordRequestDto? body,
            IPersonalDictionaryService personal,
            CancellationToken cancellationToken) =>
        {
            if (BadWordOrNull(body?.Word) is { } invalid)
                return invalid;

            await personal.RemoveAsync(body!.Word!, body.Language, cancellationToken).ConfigureAwait(false);
            return await PersonalWordsAsync(personal, cancellationToken).ConfigureAwait(false);
        });

        endpoints.MapGet("/api/proofing/notes/{noteId}/ignores", async (
            string noteId,
            INoteIgnoreService ignores,
            CancellationToken cancellationToken) =>
        {
            if (ProofingEndpoints.BadNoteIdOrNull(noteId) is { } invalid)
                return invalid;

            return await NoteIgnoresAsync(ignores, noteId, cancellationToken).ConfigureAwait(false);
        });

        endpoints.MapPost("/api/proofing/notes/{noteId}/ignores", async (
            string noteId,
            ProofingNoteIgnoreRequestDto? body,
            INoteIgnoreService ignores,
            CancellationToken cancellationToken) =>
        {
            if (ProofingEndpoints.BadNoteIdOrNull(noteId) is { } badNote)
                return badNote;

            if (BadWordOrNull(body?.Word) is { } invalid)
                return invalid;

            var added = await ignores.AddAsync(noteId, body!.Word!, cancellationToken).ConfigureAwait(false);
            if (!added)
            {
                return ProofingEndpoints.Refuse(
                    "proofing_ignore_limit",
                    $"A note ignores at most {ignores.MaxWordsPerNote} words.",
                    StatusCodes.Status409Conflict);
            }

            return await NoteIgnoresAsync(ignores, noteId, cancellationToken).ConfigureAwait(false);
        });

        endpoints.MapPost("/api/proofing/notes/{noteId}/ignores/remove", async (
            string noteId,
            ProofingNoteIgnoreRequestDto? body,
            INoteIgnoreService ignores,
            CancellationToken cancellationToken) =>
        {
            if (ProofingEndpoints.BadNoteIdOrNull(noteId) is { } badNote)
                return badNote;

            if (BadWordOrNull(body?.Word) is { } invalid)
                return invalid;

            await ignores.RemoveAsync(noteId, body!.Word!, cancellationToken).ConfigureAwait(false);
            return await NoteIgnoresAsync(ignores, noteId, cancellationToken).ConfigureAwait(false);
        });
    }

    private static async Task<IResult> PersonalWordsAsync(
        IPersonalDictionaryService personal,
        CancellationToken ct,
        PersonalWordAddResult? outcome = null)
    {
        var words = await personal.ListAsync(ct).ConfigureAwait(false);
        var label = outcome switch
        {
            PersonalWordAddResult.Added => "added",
            PersonalWordAddResult.AlreadyPresent => "alreadyPresent",
            _ => null
        };

        return Results.Json(new ProofingPersonalWordsDto([.. words.Select(ToDto)], label));
    }

    /// <summary>
    /// Null when the addition may answer with the list, otherwise the refusal to return. A word the
    /// tokenizer would never produce cannot be stored: nothing would ever be compared against it, so
    /// the list would grow an entry that silently does nothing.
    /// </summary>
    private static IResult? RefusedAddOrNull(PersonalWordAddResult outcome, int maxWords) => outcome switch
    {
        PersonalWordAddResult.NotCheckable => ProofingEndpoints.Refuse(
            "proofing_word_not_checkable",
            "A word is one run of at least two letters, with no digits and no spaces."),
        PersonalWordAddResult.LimitReached => ProofingEndpoints.Refuse(
            "proofing_word_limit",
            $"The dictionary holds at most {maxWords} words.",
            StatusCodes.Status409Conflict),
        _ => null
    };

    private static async Task<IResult> NoteIgnoresAsync(INoteIgnoreService ignores, string noteId, CancellationToken ct)
    {
        var words = await ignores.ListAsync(noteId, ct).ConfigureAwait(false);
        return Results.Json(new ProofingNoteIgnoresDto(words));
    }

    /// <summary>Null when the word may be stored, otherwise the refusal to return.</summary>
    private static IResult? BadWordOrNull(string? word)
    {
        if (string.IsNullOrWhiteSpace(word))
            return ProofingEndpoints.Refuse("proofing_word_required", "A word is required.");

        if (word.Trim().Length > ProofingEndpoints.MaxWordLength)
        {
            return ProofingEndpoints.Refuse(
                "proofing_word_too_long",
                $"A word is at most {ProofingEndpoints.MaxWordLength} characters.");
        }

        return null;
    }

    private static ProofingPersonalWordDto ToDto(PersonalWord word) => new(
        word.Word,
        word.Language,
        word.AddedAt.ToString("o", CultureInfo.InvariantCulture));
}
