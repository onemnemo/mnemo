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
    /// Reports what is enabled, which language will be used, and what each known language's state is.
    /// Starts a language loading in the background when it is installed but not yet read, so a client
    /// that polls sees <c>loading</c> turn into <c>ready</c> without having to send a check first.
    /// </summary>
    Task<ProofingStatus> GetStatusAsync(CancellationToken ct);

    /// <summary>
    /// The language a check will run in when the caller does not name one: the stored choice, else the
    /// older editor setting mapped onto an installed dictionary, else the first installed language.
    /// </summary>
    Task<string> ResolveLanguageAsync(CancellationToken ct);

    /// <summary>Whether a language tag names a dictionary that is present.</summary>
    bool IsInstalled(string language);

    /// <summary>
    /// Issues in <paramref name="text"/>, minus anything the personal dictionary or this note's ignore
    /// list covers. Returns an empty list for a language with no engine. Throws
    /// <see cref="System.OperationCanceledException"/> when the dictionary is still loading and
    /// <paramref name="ct"/> gives up waiting.
    /// </summary>
    Task<IReadOnlyList<ProofingIssue>> CheckAsync(string language, string? noteId, string text, CancellationToken ct);

    /// <summary>
    /// Replacements for the span between <paramref name="start"/> and <paramref name="end"/> of
    /// <paramref name="text"/>. Returns an empty list when the range is outside the text, when no
    /// engine serves the language, or when the engine has nothing to offer.
    /// </summary>
    Task<IReadOnlyList<ProofingFix>> SuggestAsync(
        string language,
        string text,
        int start,
        int end,
        string? ruleId,
        CancellationToken ct);
}
