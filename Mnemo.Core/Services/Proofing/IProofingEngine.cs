using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models.Proofing;

namespace Mnemo.Core.Services.Proofing;

/// <summary>
/// One source of proofing issues for one or more languages.
/// <para>
/// An engine is handed whole text and returns the spans it chose itself. Nothing above this
/// interface splits words: a spelling engine tokenizes, a grammar engine segments sentences, and a
/// style engine may look at a whole paragraph. Putting tokenization above the seam would have shaped
/// it around spelling and left no room for the other two.
/// </para>
/// </summary>
public interface IProofingEngine
{
    /// <summary>Stable identifier for this engine, used in logs and to attribute an issue.</summary>
    string Id { get; }

    /// <summary>The language tags this engine can serve, as BCP 47 tags such as <c>en-US</c>.</summary>
    IReadOnlyList<string> Languages { get; }

    /// <summary>
    /// Whether a check for this language can answer immediately. False while the language is still
    /// loading and false for a language this engine does not serve at all.
    /// </summary>
    bool IsReady(string language);

    /// <summary>
    /// Finds every issue in <paramref name="text"/>. Returns an empty list for a language this engine
    /// does not serve, for empty text, and when there is nothing to report. Offsets are UTF-16 code
    /// unit indices into <paramref name="text"/>.
    /// </summary>
    ValueTask<IReadOnlyList<ProofingIssue>> CheckAsync(string language, string text, CancellationToken ct);

    /// <summary>
    /// Proposes replacements for one issue, given the text it was found in so an engine can use the
    /// surrounding context. Returns an empty list when the engine has nothing to offer, including for
    /// a language it does not serve. Kept apart from <see cref="CheckAsync"/> because producing
    /// suggestions costs thousands of times more than deciding a word is wrong.
    /// </summary>
    ValueTask<IReadOnlyList<ProofingFix>> SuggestAsync(string language, ProofingIssue issue, string text, CancellationToken ct);
}
