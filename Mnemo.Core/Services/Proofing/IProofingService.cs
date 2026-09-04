using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Proofing;

namespace Mnemo.Core.Services.Proofing;

/// <summary>
/// The proofing surface the API talks to: engines, plus everything the user has said should not be
/// reported.
/// </summary>
public interface IProofingService
{
    /// <summary>
    /// Reports what is enabled, which languages will be used, and what each known language's state
    /// is. Starts a language loading in the background when it is installed but not yet read, so a
    /// client that polls sees <c>loading</c> turn into <c>ready</c> without having to send a check
    /// first. Names a note to have its own choice resolved alongside the global one.
    /// </summary>
    Task<ProofingStatus> GetStatusAsync(string? noteId, CancellationToken ct);

    /// <summary>
    /// The ordered set of languages a check runs in when the caller does not narrow it: the stored
    /// list, filtered to installed dictionaries. A stored list answers even when it is empty, and an
    /// empty answer means nothing is checked. Only a list that was never stored falls back, to an
    /// older single choice, then the older editor setting, then the first installed language.
    /// </summary>
    Task<IReadOnlyList<string>> ResolveActiveAsync(CancellationToken ct);

    /// <summary>
    /// What one note is checked in. A note with no stored choice follows the active set, and a note
    /// that is switched off has an empty effective set.
    /// </summary>
    Task<NoteProofing> ResolveForNoteAsync(string noteId, CancellationToken ct);

    /// <summary>Whether a language tag names a dictionary that is present.</summary>
    bool IsInstalled(string language);

    /// <summary>
    /// Issues in <paramref name="text"/>, minus anything the personal dictionary or this note's
    /// ignore list covers. A word is a mistake only when every language that answered called it one,
    /// so a word from either language passes. Returns an empty list when no language was given, when
    /// the text is empty, or when no language could be read. Throws
    /// <see cref="System.OperationCanceledException"/> when a dictionary is still loading and
    /// <paramref name="ct"/> gives up waiting.
    /// </summary>
    Task<IReadOnlyList<ProofingIssue>> CheckAsync(
        IReadOnlyList<string> languages,
        string? noteId,
        string text,
        CancellationToken ct);

    /// <summary>
    /// Replacements for the span between <paramref name="start"/> and <paramref name="end"/> of
    /// <paramref name="text"/>, from the first language that has any to offer. Returns an empty list
    /// when the range is outside the text, when no engine serves any of the languages, or when none
    /// of them has anything to offer.
    /// </summary>
    Task<IReadOnlyList<ProofingFix>> SuggestAsync(
        IReadOnlyList<string> languages,
        string text,
        int start,
        int end,
        string? ruleId,
        CancellationToken ct);
}
