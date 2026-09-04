using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using Mnemo.Core.Models.Proofing;
using Mnemo.Core.Services.Proofing;
using Mnemo.Host.Contracts;
using Mnemo.Infrastructure.Modules.Proofing;

namespace Mnemo.Host.Proofing;

/// <summary>
/// Spell checking for the editor: what the client needs before it starts, the batched check, and the
/// suggestions for one word. The lists the user adds to and the per-note language choice are mapped
/// from here and live beside this file.
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
    /// The ids count too: they are echoed back verbatim, so a bound on the text alone leaves them unbounded.
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
            [FromQuery] string? noteId,
            IProofingService proofing,
            CancellationToken cancellationToken) =>
        {
            if (BadOptionalNoteIdOrNull(noteId) is { } badNote)
                return badNote;

            var status = await proofing.GetStatusAsync(noteId, cancellationToken).ConfigureAwait(false);
            return Results.Json(ToDto(status));
        });

        endpoints.MapPost("/api/proofing/check", async (
            ProofingCheckRequestDto? body,
            IProofingService proofing,
            CancellationToken cancellationToken) =>
        {
            if (BadOptionalNoteIdOrNull(body?.NoteId) is { } badNote)
                return badNote;

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

            var languages = await ResolveAsync(proofing, body?.Languages, body?.NoteId, cancellationToken)
                .ConfigureAwait(false);

            using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            deadline.CancelAfter(deadlineAfter);

            var results = new List<ProofingParagraphResultDto>(paragraphs.Count);
            try
            {
                foreach (var paragraph in paragraphs)
                {
                    var issues = await proofing
                        .CheckAsync(languages, body?.NoteId, paragraph.Text ?? string.Empty, deadline.Token)
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

            return Results.Json(new ProofingCheckResponseDto(languages, results));
        });

        endpoints.MapPost("/api/proofing/suggest", async (
            ProofingSuggestRequestDto? body,
            IProofingService proofing,
            CancellationToken cancellationToken) =>
        {
            if (BadOptionalNoteIdOrNull(body?.NoteId) is { } badNote)
                return badNote;

            var text = body?.Text ?? string.Empty;
            var start = body?.Start ?? 0;
            var end = body?.End ?? 0;

            if (SplitsASurrogatePair(text, start, end))
            {
                return Results.Json(
                    new ErrorDto("proofing_range_invalid", "The range falls inside a surrogate pair."),
                    statusCode: StatusCodes.Status400BadRequest);
            }

            var languages = await ResolveAsync(proofing, body?.Languages, body?.NoteId, cancellationToken)
                .ConfigureAwait(false);
            var fixes = await proofing
                .SuggestAsync(languages, text, start, end, body?.RuleId, cancellationToken)
                .ConfigureAwait(false);

            return Results.Json(new ProofingSuggestResponseDto([.. fixes.Select(ToDto)]));
        });

        endpoints.MapProofingWordLists();
        endpoints.MapProofingNoteLanguages();
    }

    /// <summary>
    /// The languages a request runs in: the note's set when it named one, otherwise the resolved
    /// active set, narrowed to the caller's list when every entry of that list is already in the set.
    /// <para>
    /// Narrowing only. A hint that reaches outside the set is ignored rather than honoured, so a
    /// client a beat behind a language change cannot make a note be checked in something it did not
    /// ask for, and the answer echoes what was used so the client can tell one from the other. The
    /// editor narrows to the dictionaries it has seen become ready, which is how it keeps checking
    /// while another is still being read.
    /// </para>
    /// </summary>
    private static async Task<IReadOnlyList<string>> ResolveAsync(
        IProofingService proofing,
        IReadOnlyList<string>? requested,
        string? noteId,
        CancellationToken ct)
    {
        var effective = string.IsNullOrWhiteSpace(noteId)
            ? await proofing.ResolveActiveAsync(ct).ConfigureAwait(false)
            : (await proofing.ResolveForNoteAsync(noteId, ct).ConfigureAwait(false)).Effective;

        if (requested is null || requested.Count == 0)
            return effective;

        var narrowed = new List<string>(requested.Count);
        foreach (var id in requested)
        {
            var match = effective.FirstOrDefault(e => string.Equals(e, id, StringComparison.OrdinalIgnoreCase));
            if (match is null)
                return effective;

            if (!narrowed.Contains(match, StringComparer.Ordinal))
                narrowed.Add(match);
        }

        return narrowed;
    }

    internal static async Task<IResult> NoteLanguagesAsync(IProofingService proofing, string noteId, CancellationToken ct)
    {
        var note = await proofing.ResolveForNoteAsync(noteId, ct).ConfigureAwait(false);
        return Results.Json(ToDto(note));
    }

    internal static IResult Refuse(string code, string message, int statusCode = StatusCodes.Status400BadRequest) =>
        Results.Json(new ErrorDto(code, message), statusCode: statusCode);

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

    /// <summary>
    /// Null when the route's note id is one a note could actually have, otherwise the refusal.
    /// <para>
    /// Both per-note stores are keyed by note id inside one settings value, so an unchecked id lets
    /// anything at all become a permanent row in one.
    /// </para>
    /// </summary>
    internal static IResult? BadNoteIdOrNull(string noteId) =>
        Guid.TryParse(noteId, out _)
            ? null
            : Results.Json(
                new ErrorDto("proofing_note_invalid", "A note id must be a GUID."),
                statusCode: StatusCodes.Status400BadRequest);

    /// <summary>
    /// The same check for the routes where naming a note is optional. Nothing at all is allowed and
    /// means the request is not about one note; anything else has to be an id a note could have,
    /// because it now selects which languages the request runs in.
    /// </summary>
    private static IResult? BadOptionalNoteIdOrNull(string? noteId) =>
        string.IsNullOrWhiteSpace(noteId) ? null : BadNoteIdOrNull(noteId);

    private static IResult TooLarge(string message) => Results.Json(
        new ErrorDto("proofing_batch_too_large", message),
        statusCode: StatusCodes.Status413PayloadTooLarge);

    private static ProofingStatusDto ToDto(ProofingStatus status) => new(
        status.Enabled,
        status.Active,
        [.. status.Languages.Select(l => new ProofingLanguageDto(
            l.Id, l.Name, l.NameKey, l.Region, l.RegionKey, l.Installed, l.Bundled, l.State, l.ReasonKey,
            new ProofingLicenseDto(l.License.Name, l.License.Url)))],
        status.PersonalWordCount,
        status.Note is null ? null : ToDto(status.Note));

    private static NoteProofingDto ToDto(NoteProofing note) => new(note.Mode, note.Languages, note.Effective);

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
}
