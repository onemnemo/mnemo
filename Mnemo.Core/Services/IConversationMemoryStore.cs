using System.Collections.Generic;
using Mnemo.Core.Models;

namespace Mnemo.Core.Services;

/// <summary>
/// Per-conversation memory store: holds Tier-1 working-memory facts and the Tier-2
/// rolling summary. All operations are synchronous and in-memory; persistence is
/// handled externally by serializing <see cref="ConversationMemorySnapshot"/> with
/// the chat history document.
/// </summary>
public interface IConversationMemoryStore
{
    /// <summary>
    /// Returns the current snapshot for a conversation, or null if none exists yet.
    /// </summary>
    ConversationMemorySnapshot? Get(string conversationId);

    /// <summary>
    /// Upserts a fact into working memory. If a fact with the same <c>Key</c> already
    /// exists for the conversation it is replaced; otherwise it is appended.
    /// Evicts the oldest entry when the store exceeds the maximum fact count.
    /// </summary>
    void AddFact(string conversationId, ConversationMemoryEntry fact);

    /// <summary>
    /// Stores the new rolling summary and advances <see cref="ConversationMemorySnapshot.LastSummarizedTurn"/>.
    /// </summary>
    void SetSummary(string conversationId, ConversationSummary summary);

    /// <summary>
    /// Increments the turn counter after a user turn completes.
    /// </summary>
    void IncrementTurn(string conversationId);

    /// <summary>
    /// Marks that the conversation has Tier-3 long-term memories embedded in the vector store.
    /// </summary>
    void MarkHasLongTermMemory(string conversationId);

    /// <summary>
    /// Loads a previously persisted snapshot (e.g. on conversation load from SQLite).
    /// Replaces any in-memory state for that conversation.
    /// </summary>
    void Load(ConversationMemorySnapshot snapshot);

    /// <summary>
    /// Removes all in-memory state for the given conversation (e.g. on delete).
    /// </summary>
    void Evict(string conversationId);

    /// <summary>Removes every conversation snapshot (e.g. when clearing all chat history).</summary>
    void EvictAll();

    /// <summary>
    /// Returns all conversations that have pending summaries not yet embedded into the
    /// long-term vector store, filtered to those with turn count above <paramref name="tier3ThresholdTurns"/>.
    /// </summary>
    IReadOnlyList<ConversationMemorySnapshot> GetConversationsPendingTier3Embedding(int tier3ThresholdTurns);

}
