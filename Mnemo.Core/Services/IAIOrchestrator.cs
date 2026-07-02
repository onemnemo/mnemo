using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models;

namespace Mnemo.Core.Services;

public interface IAIOrchestrator
{
    Task<Result<string>> PromptAsync(string systemPrompt, string userPrompt, CancellationToken ct = default);

    /// <summary>
    /// Structured-output prompt: returns a JSON string conforming to <paramref name="jsonSchema"/>.
    /// </summary>
    Task<Result<string>> PromptStructuredAsync(string systemPrompt, string userPrompt, object? jsonSchema = null, CancellationToken ct = default);

    /// <summary>
    /// Streaming generation with real multi-turn conversation history. Sends proper message-list
    /// context instead of a flat text blob, improving multi-turn reasoning quality.
    /// </summary>
    /// <param name="systemPrompt">Base system prompt (mode text). Atlas composes any additional context internally.</param>
    /// <param name="history">Prior turns (oldest first, excluding the current user message).</param>
    /// <param name="userMessage">The latest user message (will become the final user turn).</param>
    /// <param name="pipelineStatus">Optional. Reports <see cref="ChatPipelineStatusKeys"/> localization keys while routing or loading.</param>
    /// <param name="conversationRoutingKey">Optional. Thread id for session continuity (same as chat session id).</param>
    /// <param name="onToolCall">Optional. Called for each tool call the assistant makes during an agentic turn (for UI process-step display).</param>
    /// <param name="onAssistantReasoningUpdate">Optional. Receives cumulative reasoning text from thinking models (not mixed into yielded tokens).</param>
    IAsyncEnumerable<string> PromptStreamingWithHistoryAsync(
        string systemPrompt,
        IReadOnlyList<ConversationTurn> history,
        string userMessage,
        CancellationToken ct = default,
        IProgress<string>? pipelineStatus = null,
        string? conversationRoutingKey = null,
        Action<ChatToolCall>? onToolCall = null,
        Action<string>? onAssistantReasoningUpdate = null);
}
