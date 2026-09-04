using System;
using System.Collections.Generic;
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
/// Spell checking for the editor, plus the two lists the user can add to.
/// <para>
/// A check is a batch because the editor sends a screen's worth of paragraphs at a time and one
/// request per paragraph would cost more in round trips than the checking itself takes. The batch is
/// bounded so a runaway client cannot ask the host to hold an unbounded document in memory.
/// </para>
/// </summary>
public static class ProofingEndpoints
{
    /// <summary>Most paragraphs one batch may carry.</summary>
    public const int MaxParagraphs = 200;

    /// <summary>
    /// Most characters one batch may carry, counted across every paragraph's id and text together.
    /// Counting only the text left the ids unbounded, and they are echoed back verbatim.
    /// </summary>
    public const int MaxCharacters = 200_000;

    /// <summary>
    /// Longest paragraph id a batch may carry. An id addresses a block and a segment within it, so it
    /// is short by construction; the bound is what stops it being a channel of its own.
    /// </summary>
    public const int MaxParagraphIdLength = 64;

    /// <summary>
    /// Longest word either list will store. Both stores are one settings value rewritten in full on
    /// every write, so an unbounded word is an unbounded row.
    /// </summary>
    public const int MaxWordLength = 100;

    /// <summary>
    /// How long a check waits for a dictionary that is still being read before giving up. Reading the
    /// largest bundled word list is a fraction of this; the bound exists so a broken file cannot hold
    /// a request open forever.
    /// </summary>
    public static readonly TimeSpan DefaultLoadTimeout = TimeSpan.FromSeconds(30);

    /// <summary>
    /// Maps every proofing route. <paramref name="loadTimeout"/> exists so the timeout path can be
    /// exercised without a test waiting out the real bound.
    /// </summary>
    public static void MapProofing(this IEndpointRouteBuilder endpoints, TimeSpan? loadTimeout = null)
    {
        var deadlineAfter = loadTimeout ?? DefaultLoadTimeout;

        endpoints.MapGet("/api/proofing/status", async (
            IProofingService proofing,
            CancellationToken cancellationToken) =>
        {
            var status = await proofing.GetStatusAsync(cancellationToken).ConfigureAwait(false);
            return Results.Json(ToDto(status));
        });

        endpoints.MapPost("/api/proofing/check", async (
            ProofingCheckRequestDto? body,
            IProofingService proofing,
            CancellationToken cancellationToken) =>
        {
            var paragraphs = body?.Paragraphs ?? [];
            if (paragraphs.Count > MaxParagraphs)
                return TooLarge($"A check carries at most {MaxParagraphs} paragraphs.");

            // A JSON null in the array deserialises to a null entry. Reading through one is a
            // NullReferenceException out of the handler, which the host reports as an internal error
            // rather than as the malformed request it is.
            if (paragraphs.Any(p => p is null || string.IsNullOrEmpty(p.Id) || p.Id.Length > MaxParagraphIdLength))
            {
                return Results.Json(
                    new ErrorDto(
                        "proofing_paragraph_invalid",
                        $"Every paragraph needs an id of at most {MaxParagraphIdLength} characters and must not be null."),
                    statusCode: StatusCodes.Status400BadRequest);
            }

            var characters = paragraphs.Sum(p => (p.Id?.Length ?? 0) + (p.Text?.Length ?? 0));
            if (characters > MaxCharacters)
                return TooLarge($"A check carries at most {MaxCharacters} characters.");

            var language = await ResolveAsync(proofing, body?.Language, cancellationToken).ConfigureAwait(false);

            using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            deadline.CancelAfter(deadlineAfter);

            var results = new List<ProofingParagraphResultDto>(paragraphs.Count);
            try
            {
                foreach (var paragraph in paragraphs)
                {
                    var issues = await proofing
                        .CheckAsync(language, body?.NoteId, paragraph.Text ?? string.Empty, deadline.Token)
                        .ConfigureAwait(false);

                    results.Add(new ProofingParagraphResultDto(paragraph.Id!, [.. issues.Select(ToDto)]));
                }
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
            {
                // The dictionary is still being read. 503 rather than 500 because the client can act on
                // it: leave the paragraphs unchecked and ask again.
                return Results.Json(
                    new ErrorDto("proofing_loading", "The dictionary is still loading."),
                    statusCode: StatusCodes.Status503ServiceUnavailable);
            }

            return Results.Json(new ProofingCheckResponseDto(language, results));
        });

        endpoints.MapPost("/api/proofing/suggest", async (
            ProofingSuggestRequestDto? body,
            IProofingService proofing,
            CancellationToken cancellationToken) =>
        {
            var text = body?.Text ?? string.Empty;
            var start = body?.Start ?? 0;
            var end = body?.End ?? 0;

            if (SplitsASurrogatePair(text, start, end))
            {
                return Results.Json(
                    new ErrorDto("proofing_range_invalid", "The range falls inside a surrogate pair."),
                    statusCode: StatusCodes.Status400BadRequest);
            }

            var language = await ResolveAsync(proofing, body?.Language, cancellationToken).ConfigureAwait(false);
            var fixes = await proofing
                .SuggestAsync(language, text, start, end, body?.RuleId, cancellationToken)
                .ConfigureAwait(false);

            return Results.Json(new ProofingSuggestResponseDto([.. fixes.Select(ToDto)]));
        });

        endpoints.MapGet("/api/proofing/personal", async (
            IPersonalDictionaryService personal,
            CancellationToken cancellationToken) =>
        {
            var words = await personal.ListAsync(cancellationToken).ConfigureAwait(false);
            return Results.Json(new ProofingPersonalWordsDto([.. words.Select(ToDto)]));
        });

        endpoints.MapPost("/api/proofing/personal", async (
            ProofingPersonalWordRequestDto? body,
            IPersonalDictionaryService personal,
            CancellationToken cancellationToken) =>
        {
            if (BadWordOrNull(body?.Word) is { } invalid)
                return invalid;

            await personal.AddAsync(body!.Word!, body.Language, cancellationToken).ConfigureAwait(false);
            return await PersonalWordsAsync(personal, cancellationToken).ConfigureAwait(false);
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
            if (BadNoteIdOrNull(noteId) is { } invalid)
                return invalid;

            var words = await ignores.ListAsync(noteId, cancellationToken).ConfigureAwait(false);
            return Results.Json(new ProofingNoteIgnoresDto(words));
        });

        endpoints.MapPost("/api/proofing/notes/{noteId}/ignores", async (
            string noteId,
            ProofingNoteIgnoreRequestDto? body,
            INoteIgnoreService ignores,
            CancellationToken cancellationToken) =>
        {
            if (BadNoteIdOrNull(noteId) is { } badNote)
                return badNote;

            if (BadWordOrNull(body?.Word) is { } invalid)
                return invalid;

            var added = await ignores.AddAsync(noteId, body!.Word!, cancellationToken).ConfigureAwait(false);
            if (!added)
            {
                return Results.Json(
                    new ErrorDto("proofing_ignore_limit", $"A note ignores at most {ignores.MaxWordsPerNote} words."),
                    statusCode: StatusCodes.Status409Conflict);
            }

            return await NoteIgnoresAsync(ignores, noteId, cancellationToken).ConfigureAwait(false);
        });

        endpoints.MapPost("/api/proofing/notes/{noteId}/ignores/remove", async (
            string noteId,
            ProofingNoteIgnoreRequestDto? body,
            INoteIgnoreService ignores,
            CancellationToken cancellationToken) =>
        {
            if (BadNoteIdOrNull(noteId) is { } badNote)
                return badNote;

            if (BadWordOrNull(body?.Word) is { } invalid)
                return invalid;

            await ignores.RemoveAsync(noteId, body!.Word!, cancellationToken).ConfigureAwait(false);
            return await NoteIgnoresAsync(ignores, noteId, cancellationToken).ConfigureAwait(false);
        });
    }

    /// <summary>
    /// Uses the language the caller asked for when a dictionary for it is installed, and otherwise the
    /// one the host resolved. A client that has not read status yet, or that is a beat behind a
    /// language change, gets a real answer rather than an empty one.
    /// </summary>
    private static async Task<string> ResolveAsync(IProofingService proofing, string? requested, CancellationToken ct)
    {
        if (!string.IsNullOrWhiteSpace(requested) && proofing.IsInstalled(requested))
            return requested;

        return await proofing.ResolveLanguageAsync(ct).ConfigureAwait(false);
    }

    private static async Task<IResult> PersonalWordsAsync(IPersonalDictionaryService personal, CancellationToken ct)
    {
        var words = await personal.ListAsync(ct).ConfigureAwait(false);
        return Results.Json(new ProofingPersonalWordsDto([.. words.Select(ToDto)]));
    }

    private static async Task<IResult> NoteIgnoresAsync(INoteIgnoreService ignores, string noteId, CancellationToken ct)
    {
        var words = await ignores.ListAsync(noteId, ct).ConfigureAwait(false);
        return Results.Json(new ProofingNoteIgnoresDto(words));
    }

    /// <summary>
    /// Whether either end of the range lands between the two halves of a surrogate pair.
    /// <para>
    /// A suggest request carries the current text with the offsets of an earlier check, so an edit in
    /// between can leave them describing half an astral character. Slicing that out produces a string
    /// the normalisation and lookup paths cannot represent, and the honest answer is that the client's
    /// offsets are stale and it should check again, not an empty suggestion list that looks like a word
    /// with nothing to offer.
    /// </para>
    /// </summary>
    private static bool SplitsASurrogatePair(string text, int start, int end)
    {
        if (start < 0 || end > text.Length || end <= start)
            return false;

        return IsInsideAPair(text, start) || IsInsideAPair(text, end);
    }

    private static bool IsInsideAPair(string text, int index) =>
        index > 0
        && index < text.Length
        && char.IsLowSurrogate(text[index])
        && char.IsHighSurrogate(text[index - 1]);

    /// <summary>Null when the word may be stored, otherwise the refusal to return.</summary>
    private static IResult? BadWordOrNull(string? word)
    {
        if (string.IsNullOrWhiteSpace(word))
        {
            return Results.Json(
                new ErrorDto("proofing_word_required", "A word is required."),
                statusCode: StatusCodes.Status400BadRequest);
        }

        if (word.Trim().Length > MaxWordLength)
        {
            return Results.Json(
                new ErrorDto("proofing_word_too_long", $"A word is at most {MaxWordLength} characters."),
                statusCode: StatusCodes.Status400BadRequest);
        }

        return null;
    }

    /// <summary>
    /// Null when the route's note id is one a note could actually have, otherwise the refusal.
    /// <para>
    /// Ignore lists are keyed by note id in one settings value, so an unchecked id lets anything at all
    /// become a permanent row in it.
    /// </para>
    /// </summary>
    private static IResult? BadNoteIdOrNull(string noteId) =>
        Guid.TryParse(noteId, out _)
            ? null
            : Results.Json(
                new ErrorDto("proofing_note_invalid", "A note id must be a GUID."),
                statusCode: StatusCodes.Status400BadRequest);

    private static IResult TooLarge(string message) => Results.Json(
        new ErrorDto("proofing_batch_too_large", message),
        statusCode: StatusCodes.Status413PayloadTooLarge);

    private static ProofingStatusDto ToDto(ProofingStatus status) => new(
        status.Enabled,
        status.Language,
        [.. status.Languages.Select(l => new ProofingLanguageDto(
            l.Id, l.Name, l.Region, l.Installed, l.Bundled, l.State, l.ReasonKey,
            new ProofingLicenseDto(l.License.Name, l.License.Url)))],
        status.PersonalWordCount);

    private static ProofingIssueDto ToDto(ProofingIssue issue) => new(
        issue.Start,
        issue.End,
        issue.Text,
        issue.Kind,
        issue.Tone,
        issue.RuleId,
        issue.TitleKey,
        issue.MessageKey,
        issue.Fixes.Count == 0 ? null : [.. issue.Fixes.Select(ToDto)]);

    private static ProofingFixDto ToDto(ProofingFix fix) => new(fix.Replacement, fix.Label);

    private static ProofingPersonalWordDto ToDto(PersonalWord word) => new(
        word.Word,
        word.Language,
        word.AddedAt.ToString("o", CultureInfo.InvariantCulture));
}
