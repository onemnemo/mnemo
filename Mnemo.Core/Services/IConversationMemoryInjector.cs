using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models;

namespace Mnemo.Core.Services;

/// <summary>
/// Composes the message history that is passed to the main chat model, replacing
/// the flat raw-text rolling window with a memory-aware structure:
/// <list type="bullet">
///   <item>A synthetic assistant turn containing the latest rolling summary (Tier 2),
///         including active entity IDs and key facts.</item>
///   <item>The K most recent raw turns verbatim (for turn-level coherence).</item>
///   <item>Optionally, Tier-3 semantic recall appended to the summary turn.</item>
/// </list>
/// </summary>
public interface IConversationMemoryInjector
{
    /// <summary>
    /// Builds the composed history list ready to pass as <c>history</c> to
    /// <see cref="IAIOrchestrator.PromptStreamingWithHistoryAsync"/>.
    /// </summary>
    /// <param name="conversationId">Used to look up the memory snapshot.</param>
    /// <param name="allRawTurns">All persisted user/assistant turns, oldest first (the full chat window).</param>
    /// <param name="userMessage">The current (new) user message, used for Tier-3 semantic search.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>
    /// When a summary exists: <c>[synthetic summary turn] + [last K raw turns]</c>.
    /// When no summary yet: falls back to the last <c>MaxContextMessageCount</c> raw turns unchanged.
    /// </returns>
    Task<IReadOnlyList<ConversationTurn>> BuildHistoryWithMemoryAsync(
        string conversationId,
        IReadOnlyList<ConversationTurn> allRawTurns,
        string userMessage,
        CancellationToken ct = default);
}
