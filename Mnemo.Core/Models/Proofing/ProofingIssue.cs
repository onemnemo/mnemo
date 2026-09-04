using System.Collections.Generic;

namespace Mnemo.Core.Models.Proofing;

/// <summary>
/// One span of text an engine has something to say about.
/// </summary>
/// <param name="Start">
/// Index of the first character, counted in UTF-16 code units from the start of the text that was
/// checked. The web client indexes JavaScript strings the same way, so an offset crosses the wire
/// without conversion.
/// </param>
/// <param name="End">Index one past the last character, in the same units. Exclusive.</param>
/// <param name="Text">The flagged text exactly as it appears, so a caller can revalidate the range.</param>
/// <param name="Kind">
/// What sort of check produced this, as an open string (<c>spelling</c> today). Open rather than an
/// enum because a grammar or style engine registered later contributes its own kinds, and a closed
/// set would make that a wire change.
/// </param>
/// <param name="Tone">How the client paints it: <c>error</c> or <c>unknown</c>.</param>
/// <param name="RuleId">The engine's own identifier for the rule that fired, when it has one.</param>
/// <param name="TitleKey">Translation key for a headline, when the engine offers one.</param>
/// <param name="MessageKey">Translation key for a one-sentence explanation, when the engine offers one.</param>
/// <param name="Fixes">
/// Replacements the engine can offer without further work. Empty when producing them is expensive
/// enough to belong in a separate request, which is the case for spelling suggestions.
/// </param>
public sealed record ProofingIssue(
    int Start,
    int End,
    string Text,
    string Kind,
    string Tone,
    string? RuleId,
    string? TitleKey,
    string? MessageKey,
    IReadOnlyList<ProofingFix> Fixes);
