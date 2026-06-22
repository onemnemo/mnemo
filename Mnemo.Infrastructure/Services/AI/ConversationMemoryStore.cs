using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using Mnemo.Core.Models;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Services.AI;

/// <summary>
/// In-memory implementation of <see cref="IConversationMemoryStore"/>.
/// Snapshots are loaded from / saved to SQLite by <see cref="IChatModuleHistoryService"/>
/// via the <see cref="ChatModulePersistedConversation.MemorySnapshotJson"/> field;
/// this class only manages the runtime in-memory state.
/// </summary>
public sealed class ConversationMemoryStore : IConversationMemoryStore
{
    /// <summary>Maximum facts retained per conversation before the oldest are evicted.</summary>
    public const int MaxFactsPerConversation = 20;

    private readonly ILoggerService _logger;

    private readonly ConcurrentDictionary<string, ConversationMemorySnapshot> _snapshots =
        new(StringComparer.Ordinal);

    public ConversationMemoryStore(ILoggerService logger)
    {
        _logger = logger;
    }

    public ConversationMemorySnapshot? Get(string conversationId)
    {
        if (string.IsNullOrWhiteSpace(conversationId))
            return null;

        return _snapshots.TryGetValue(conversationId, out var s) ? s : null;
    }

    public void AddFact(string conversationId, ConversationMemoryEntry fact)
    {
        if (string.IsNullOrWhiteSpace(conversationId) || fact == null)
            return;

        var snapshot = GetOrCreate(conversationId);

        lock (snapshot)
        {
            // Upsert by key: replace existing fact with the same semantic key
            var existing = snapshot.Facts.FindIndex(f =>
                string.Equals(f.Key, fact.Key, StringComparison.OrdinalIgnoreCase));

            if (existing >= 0)
                snapshot.Facts[existing] = fact;
            else
                snapshot.Facts.Add(fact);

            // Evict oldest entries when over capacity
            while (snapshot.Facts.Count > MaxFactsPerConversation)
                snapshot.Facts.RemoveAt(0);
        }

        _logger.Debug("Memory",
            $"Store: fact upsert conv={conversationId} key={fact.Key} source={fact.Source}");
    }

    public void SetSummary(string conversationId, ConversationSummary summary)
    {
        if (string.IsNullOrWhiteSpace(conversationId) || summary == null)
            return;

        var snapshot = GetOrCreate(conversationId);
        lock (snapshot)
        {
            snapshot.LatestSummary = summary;
            snapshot.LastSummarizedTurn = summary.CoveredThroughTurn;
        }

        _logger.Info("Memory",
            $"Store: summary set conv={conversationId} coveredThroughTurn={summary.CoveredThroughTurn} active_skill={summary.ActiveSkill}");
    }

    public void IncrementTurn(string conversationId)
    {
        if (string.IsNullOrWhiteSpace(conversationId))
            return;

        var snapshot = GetOrCreate(conversationId);
        int turn;
        lock (snapshot)
        {
            snapshot.TurnCount++;
            turn = snapshot.TurnCount;
        }

        _logger.Debug("Memory", $"Store: increment conv={conversationId} turnCount={turn}");
    }

    public void MarkHasLongTermMemory(string conversationId)
    {
        if (string.IsNullOrWhiteSpace(conversationId))
            return;

        var snapshot = GetOrCreate(conversationId);
        lock (snapshot)
        {
            snapshot.HasLongTermMemory = true;
        }

        _logger.Info("Memory", $"Store: tier3 flag conv={conversationId}");
    }

    public void Load(ConversationMemorySnapshot snapshot)
    {
        if (snapshot == null || string.IsNullOrWhiteSpace(snapshot.ConversationId))
            return;

        _snapshots[snapshot.ConversationId] = snapshot;
        _logger.Info("Memory",
            $"Store: hydrated conv={snapshot.ConversationId} turnCount={snapshot.TurnCount} facts={snapshot.Facts.Count} hasSummary={snapshot.LatestSummary != null}");
    }

    public void Evict(string conversationId)
    {
        if (string.IsNullOrWhiteSpace(conversationId))
            return;

        _snapshots.TryRemove(conversationId, out _);
        _logger.Info("Memory", $"Store: evicted conv={conversationId}");
    }

    public void EvictAll()
    {
        _snapshots.Clear();
        _logger.Info("Memory", "Store: evicted all conversations");
    }

    public IReadOnlyList<ConversationMemorySnapshot> GetConversationsPendingTier3Embedding(int tier3ThresholdTurns)
    {
        return _snapshots.Values
            .Where(s => !s.HasLongTermMemory
                && s.LatestSummary != null
                && s.TurnCount >= tier3ThresholdTurns)
            .ToList();
    }

    private ConversationMemorySnapshot GetOrCreate(string conversationId)
    {
        return _snapshots.GetOrAdd(conversationId, id => new ConversationMemorySnapshot
        {
            ConversationId = id
        });
    }
}
