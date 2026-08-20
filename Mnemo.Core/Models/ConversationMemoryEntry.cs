using System;
using System.Collections.Generic;

namespace Mnemo.Core.Models;

/// <summary>
/// A single structured fact extracted from a tool result within a conversation turn.
/// Facts are keyed by semantic role (e.g. "active_note_id") and carry the raw value,
/// the tool that produced it, and when in the conversation it was learned.
/// </summary>
public sealed class ConversationMemoryEntry
{
    /// <summary>Semantic key, e.g. "active_note_id", "listed_note_ids", "active_mindmap_id".</summary>
    public string Key { get; init; } = string.Empty;

    /// <summary>The value, a scalar string or compact JSON for lists.</summary>
    public string Value { get; init; } = string.Empty;

    /// <summary>Tool name that produced this fact.</summary>
    public string Source { get; init; } = string.Empty;

    public DateTime CreatedUtc { get; init; } = DateTime.UtcNow;

    /// <summary>Turn number (1-based) in which this fact was learned.</summary>
    public int TurnNumber { get; init; }
}

/// <summary>
/// Per-conversation memory state: working-memory facts (Tier 1) plus the latest
/// rolling summary produced by the manager model (Tier 2).
/// Persisted as JSON alongside <see cref="ChatModulePersistedConversation"/>.
/// </summary>
public sealed class ConversationMemorySnapshot
{
    public string ConversationId { get; init; } = string.Empty;

    /// <summary>
    /// Structured facts extracted from tool results since the last summary.
    /// Entries with the same <see cref="ConversationMemoryEntry.Key"/> are replaced (upserted),
    /// so this always reflects the most recent known value for each fact type.
    /// </summary>
    public List<ConversationMemoryEntry> Facts { get; set; } = new();

    /// <summary>The most recent rolling summary produced by the manager model. Null until first summarization.</summary>
    public ConversationSummary? LatestSummary { get; set; }

    /// <summary>Total number of completed turns in this conversation.</summary>
    public int TurnCount { get; set; }

    /// <summary>The turn number through which the latest summary was computed.</summary>
    public int LastSummarizedTurn { get; set; }

    /// <summary>Whether any summaries have been embedded into the vector store (Tier 3 active).</summary>
    public bool HasLongTermMemory { get; set; }
}
