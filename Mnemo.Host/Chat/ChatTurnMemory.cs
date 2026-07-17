using System.Text.Json;
using Mnemo.Core.Models;
using Mnemo.Core.Services;

namespace Mnemo.Host.Chat;

/// <summary>
/// Conversation-memory maintenance for one chat turn, mirroring the desktop's ChatViewModel flow. Before
/// the turn the rolling summary is hydrated from the persisted snapshot so the injector can fold it into
/// the model context; after the turn the turn counter advances and, once enough turns have accumulated, a
/// fresh summary compresses the turns since the last one. The updated snapshot is serialized back so it
/// rides alongside the turn in the shared history document.
/// </summary>
public static class ChatTurnMemory
{
    /// <summary>Summarize once this many turns have passed since the last summary (matches the desktop).</summary>
    private const int SummarizationInterval = 3;

    /// <summary>Loads the persisted memory snapshot into the store so the injector sees prior summaries.</summary>
    public static void Hydrate(IConversationMemoryStore store, ILoggerService logger, string? memorySnapshotJson)
    {
        if (string.IsNullOrWhiteSpace(memorySnapshotJson))
            return;

        try
        {
            var snapshot = JsonSerializer.Deserialize<ConversationMemorySnapshot>(memorySnapshotJson);
            if (snapshot is not null && !string.IsNullOrWhiteSpace(snapshot.ConversationId))
                store.Load(snapshot);
        }
        catch (Exception ex)
        {
            logger.Warning("Memory", $"Failed to hydrate memory snapshot: {ex.Message}");
        }
    }

    /// <summary>
    /// Advances the turn counter and, when a summary is due, compresses the turns since the last summary
    /// into a new rolling one. Returns the snapshot serialized for persistence, or null if there is none.
    /// The summarizer call is not tied to the request lifetime so a client disconnect cannot abort it.
    /// </summary>
    public static async Task<string?> RunPostTurnAsync(
        IConversationMemoryStore store,
        IConversationSummarizer summarizer,
        ILoggerService logger,
        string conversationId,
        IReadOnlyList<ConversationTurn> fullTranscriptOldestFirst)
    {
        store.IncrementTurn(conversationId);

        try
        {
            var snapshot = store.Get(conversationId);
            if (snapshot is not null && snapshot.TurnCount - snapshot.LastSummarizedTurn >= SummarizationInterval)
            {
                // The transcript is [U1,A1,U2,A2,...]; each already-summarized turn is two entries.
                var pairStartIndex = 2 * snapshot.LastSummarizedTurn;
                if (pairStartIndex < fullTranscriptOldestFirst.Count)
                {
                    var newTurns = fullTranscriptOldestFirst.Skip(pairStartIndex).ToList();
                    if (newTurns.Count > 0)
                    {
                        var result = await summarizer.SummarizeAsync(snapshot, newTurns).ConfigureAwait(false);
                        if (result.IsSuccess && result.Value is not null)
                            store.SetSummary(conversationId, result.Value);
                        else
                            logger.Warning("Memory", $"PostTurn: summarization failed conv={conversationId}: {result.ErrorMessage}");
                    }
                }
            }
        }
        catch (Exception ex)
        {
            // Memory maintenance is best-effort: a failed summary leaves the counter advanced and retries next interval.
            logger.Warning("Memory", $"PostTurn: maintenance failed conv={conversationId}: {ex.Message}");
        }

        var finalSnapshot = store.Get(conversationId);
        return finalSnapshot is null ? null : JsonSerializer.Serialize(finalSnapshot);
    }
}
