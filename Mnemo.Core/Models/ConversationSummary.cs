using System;
using System.Collections.Generic;

namespace Mnemo.Core.Models;

/// <summary>
/// Structured output of the manager model's <c>convo_summarize</c> task.
/// Contains a dense prose summary, all active entity IDs, key facts, and the most
/// recently active skill. Together these are everything needed to reconstruct context for the next turn.
/// </summary>
public sealed class ConversationSummary
{
    /// <summary>
    /// Prose summary (≤3 sentences) written as if a new assistant is taking over mid-session.
    /// Describes what has been done, what the user wants, and any relevant background.
    /// </summary>
    public string Summary { get; init; } = string.Empty;

    /// <summary>
    /// Entity IDs that are still active/relevant, keyed by typed role.
    /// Examples: <c>{ "note_id": "abc-123", "mindmap_id": "xyz-789" }</c>.
    /// </summary>
    public Dictionary<string, string> ActiveEntities { get; init; } = new();

    /// <summary>Short-phrase facts (under 10 words each) that do not fit in prose or entities.</summary>
    public List<string> KeyFacts { get; init; } = new();

    /// <summary>
    /// The skill the conversation was most recently using.
    /// Used by routing to correctly classify short follow-ups like "yes", "do it", "add more".
    /// </summary>
    public string ActiveSkill { get; init; } = "NONE";

    /// <summary>The turn number through which this summary was computed (inclusive).</summary>
    public int CoveredThroughTurn { get; init; }

    public DateTime CreatedUtc { get; init; } = DateTime.UtcNow;
}
