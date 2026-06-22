using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models;
using Mnemo.Core.Services;

namespace Mnemo.UI.Services;

/// <summary>
/// Shared streaming chat logic used by the Chat module and Right Sidebar assistant.
/// </summary>
public static class ChatStreamingHelper
{
    private const string AssistantBaseSystemPrompt = @"You are Mnemo's in-app assistant.

- Use Markdown. Default to English unless the user asks otherwise.
- Do not invent app UI, settings, or features. If something is uncertain, say so briefly or ask one focused question.
- Pure study or subject questions: answer directly—no need to mention the app unless relevant.
- When tools are available, use them to read or change user data instead of only describing what you would do.
- Call only functions whose names appear in the current tool list. Core includes get_skills, fetch_skill, inject_skill, navigate_to. " +
        "After get_skills, if the user needs Notes/Mindmap/Settings actions, call inject_skill with that skill_id (e.g. Notes). fetch_skill is preview-only. navigate_to only opens UI — it does not enable list_notes or other module tools.";

    /// <summary>Short answers: minimal length while staying helpful.</summary>
    public const string ShortSystemPrompt = AssistantBaseSystemPrompt + @"

Response length: SHORT. Give the briefest answer that still satisfies the question—typically a sentence or two, or a few tight bullets. No preamble, recap, or filler unless the user asks for more.";

    /// <summary>Balanced length (default).</summary>
    public const string NormalSystemPrompt = AssistantBaseSystemPrompt + @"

Response length: NORMAL. Answer clearly and directly. Use short lists or steps when they help; avoid long essays unless the question needs it.";

    /// <summary>Thorough answers with examples and structure when useful.</summary>
    public const string DetailedSystemPrompt = AssistantBaseSystemPrompt + @"

Response length: DETAILED. Be thorough: explain reasoning, add examples, steps, or tables when they clarify. Use LaTeX for math when useful. Stay focused—no padding.";

    /// <summary>Default system prompt (Normal). Kept for backward compatibility.</summary>
    public static string DefaultSystemPrompt => NormalSystemPrompt;

    /// <summary>Maps persisted or UI mode ids to Short, Normal, or Detailed (including legacy General / Explainer).</summary>
    public static string NormalizeAssistantMode(string? mode)
    {
        if (string.IsNullOrWhiteSpace(mode)) return "Normal";
        if (string.Equals(mode, "Short", StringComparison.OrdinalIgnoreCase)) return "Short";
        if (string.Equals(mode, "Normal", StringComparison.OrdinalIgnoreCase)) return "Normal";
        if (string.Equals(mode, "Detailed", StringComparison.OrdinalIgnoreCase)) return "Detailed";
        if (string.Equals(mode, "General", StringComparison.OrdinalIgnoreCase)) return "Normal";
        if (string.Equals(mode, "Explainer", StringComparison.OrdinalIgnoreCase)) return "Detailed";
        return "Normal";
    }

    /// <summary>Returns the system prompt for the given response-length mode (Short, Normal, Detailed).</summary>
    public static string GetSystemPromptForMode(string mode)
    {
        return NormalizeAssistantMode(mode) switch
        {
            "Short" => ShortSystemPrompt,
            "Detailed" => DetailedSystemPrompt,
            _ => NormalSystemPrompt
        };
    }

    /// <summary>Delay between UI reveal steps while streaming (smooth display, not network pacing) — matches <see cref="ChatStreamingDisplayOptions.Balanced"/>.</summary>
    public const int StreamingDisplayTickMs = 22;

    /// <summary>Maximum characters revealed per tick toward the buffered response — matches <see cref="ChatStreamingDisplayOptions.Balanced"/>.</summary>
    public const int StreamingCharsPerTick = 6;

    /// <summary>Max number of recent messages to include in context (conversation window).</summary>
    public const int MaxContextMessageCount = 11;

    /// <summary>
    /// Builds a structured conversation history from recent messages for multi-turn prompting.
    /// Returns turns oldest-first, excluding the current placeholder (empty assistant) message.
    /// </summary>
    /// <param name="messages">All messages (newest at end).</param>
    /// <param name="excludeMessage">Optional message to exclude (e.g. the placeholder AI message being filled).</param>
    /// <param name="isUser">Predicate: true if the message is from the user.</param>
    /// <param name="getContent">Selector for message content.</param>
    /// <param name="excludeLastUserTurn">
    /// When true, drops the last message if it is a user message. Use with
    /// <see cref="IAIOrchestrator.PromptStreamingWithHistoryAsync"/> which appends <c>userMessage</c> separately—otherwise the latest user turn appears twice.
    /// </param>
    public static IReadOnlyList<ConversationTurn> BuildConversationHistory<T>(
        IList<T> messages,
        T? excludeMessage,
        Func<T, bool> isUser,
        Func<T, string> getContent,
        bool excludeLastUserTurn = false)
    {
        var recent = messages
            .TakeLast(MaxContextMessageCount)
            .Where(m => !ReferenceEquals(m, excludeMessage))
            .ToList();

        if (excludeLastUserTurn && recent.Count > 0 && isUser(recent[^1]))
            recent.RemoveAt(recent.Count - 1);

        if (recent.Count == 0) return Array.Empty<ConversationTurn>();

        return recent
            .Select(m => new ConversationTurn(
                isUser(m) ? ConversationRole.User : ConversationRole.Assistant,
                getContent(m)))
            .ToList();
    }

    /// <summary>
    /// Full session transcript as <see cref="ConversationTurn"/> list (no <see cref="MaxContextMessageCount"/> cap).
    /// Use for memory summarization so "new turns since last summary" is not truncated.
    /// Oldest first; include the latest assistant reply once it is finalized.
    /// </summary>
    public static IReadOnlyList<ConversationTurn> BuildFullConversationHistory<T>(
        IList<T> messages,
        Func<T, bool> isUser,
        Func<T, string> getContent)
    {
        if (messages == null || messages.Count == 0) return Array.Empty<ConversationTurn>();

        return messages
            .Select(m => new ConversationTurn(
                isUser(m) ? ConversationRole.User : ConversationRole.Assistant,
                getContent(m)))
            .ToList();
    }

    /// <summary>
    /// Runs the streaming prompt loop using real multi-turn conversation history. History turns are passed
    /// as proper message objects instead of a flat text blob, improving multi-turn reasoning quality.
    /// </summary>
    /// <param name="systemPrompt">Base system prompt only (mode text).</param>
    /// <param name="history">Prior turns (oldest first, not including the current user message).</param>
    /// <param name="userMessage">The latest user message.</param>
    /// <param name="pipelineStatus">Optional. Receives pipeline label keys.</param>
    /// <param name="conversationRoutingKey">Optional. Thread id for session continuity (same as chat session id).</param>
    /// <param name="displayOptions">Optional. Reveal pacing.</param>
    /// <param name="onAssistantReasoningUpdate">Optional. Cumulative model reasoning for thinking models (UI thought panel).</param>
    /// <returns>True if at least one token was received; false if empty response.</returns>
    public static async Task<(bool FoundResponse, string FinalContent)> RunStreamingWithHistoryAsync(
        IAIOrchestrator orchestrator,
        string systemPrompt,
        IReadOnlyList<ConversationTurn> history,
        string userMessage,
        CancellationToken cancellationToken,
        Action<string> onContentUpdate,
        IProgress<string>? pipelineStatus = null,
        string? conversationRoutingKey = null,
        ChatStreamingDisplayOptions? displayOptions = null,
        Action<ChatToolCall>? onToolCall = null,
        Action<string>? onAssistantReasoningUpdate = null)
    {
        var options = displayOptions ?? ChatStreamingDisplayOptions.Balanced;
        var throttledPipeline = ThrottlePipeline(pipelineStatus, minIntervalMs: 80);
        var emitContent = CreateThrottledContentEmitter(onContentUpdate, ChatStreamingDisplayOptions.DefaultUiThrottleMs);

        if (options.IsInstant)
            return await RunInstantWithHistoryAsync(
                orchestrator,
                systemPrompt,
                history,
                userMessage,
                cancellationToken,
                emitContent,
                throttledPipeline,
                conversationRoutingKey,
                onToolCall,
                onAssistantReasoningUpdate).ConfigureAwait(false);

        return await RunRevealWithHistoryAsync(
            orchestrator,
            systemPrompt,
            history,
            userMessage,
            cancellationToken,
            emitContent,
            throttledPipeline,
            conversationRoutingKey,
            options,
            onToolCall,
            onAssistantReasoningUpdate).ConfigureAwait(false);
    }

    private static IProgress<string>? ThrottlePipeline(IProgress<string>? inner, int minIntervalMs)
    {
        if (inner == null)
            return null;

        var last = DateTime.MinValue;
        string? lastKey = null;
        return new Progress<string>(s =>
        {
            var now = DateTime.UtcNow;
            var sameKey = string.Equals(s, lastKey, StringComparison.Ordinal);
            if (sameKey && (now - last).TotalMilliseconds < minIntervalMs)
                return;
            last = now;
            lastKey = s;
            inner.Report(s);
        });
    }

    private static Action<string, bool> CreateThrottledContentEmitter(Action<string> inner, int minIntervalMs)
    {
        var last = DateTime.MinValue;
        return (slice, force) =>
        {
            var now = DateTime.UtcNow;
            if (!force && (now - last).TotalMilliseconds < minIntervalMs)
                return;
            last = now;
            inner(slice);
        };
    }

    private static async Task<(bool FoundResponse, string FinalContent)> RunInstantWithHistoryAsync(
        IAIOrchestrator orchestrator,
        string systemPrompt,
        IReadOnlyList<ConversationTurn> history,
        string userMessage,
        CancellationToken cancellationToken,
        Action<string, bool> emitContent,
        IProgress<string>? pipelineStatus,
        string? conversationRoutingKey,
        Action<ChatToolCall>? onToolCall = null,
        Action<string>? onAssistantReasoningUpdate = null)
    {
        var buffer = new StringBuilder();
        var lockObj = new object();
        var foundResponse = false;

        try
        {
            await foreach (var token in orchestrator.PromptStreamingWithHistoryAsync(systemPrompt, history, userMessage, cancellationToken, pipelineStatus, conversationRoutingKey, onToolCall, onAssistantReasoningUpdate)
                .ConfigureAwait(false))
            {
                lock (lockObj)
                {
                    buffer.Append(token);
                    foundResponse = true;
                }

                string snapshot;
                lock (lockObj)
                {
                    snapshot = buffer.ToString();
                }

                emitContent(snapshot, false);
            }
        }
        catch (OperationCanceledException)
        {
            lock (lockObj)
            {
                emitContent(buffer.ToString(), true);
            }

            throw;
        }

        var finalContent = buffer.ToString();
        emitContent(finalContent, true);

        bool found;
        lock (lockObj)
        {
            found = foundResponse;
        }

        return (found, finalContent);
    }

    private static async Task<(bool FoundResponse, string FinalContent)> RunRevealWithHistoryAsync(
        IAIOrchestrator orchestrator,
        string systemPrompt,
        IReadOnlyList<ConversationTurn> history,
        string userMessage,
        CancellationToken cancellationToken,
        Action<string, bool> emitContent,
        IProgress<string>? pipelineStatus,
        string? conversationRoutingKey,
        ChatStreamingDisplayOptions options,
        Action<ChatToolCall>? onToolCall = null,
        Action<string>? onAssistantReasoningUpdate = null)
    {
        var buffer = new StringBuilder();
        var lockObj = new object();
        var streamComplete = false;
        var revealedLength = 0;
        var foundResponse = false;

        var tickMs = Math.Max(1, options.TickMs);
        var charsPerTick = Math.Max(1, options.CharsPerTick);

        async Task ProducerAsync()
        {
            try
            {
                await foreach (var token in orchestrator.PromptStreamingWithHistoryAsync(systemPrompt, history, userMessage, cancellationToken, pipelineStatus, conversationRoutingKey, onToolCall, onAssistantReasoningUpdate)
                    .ConfigureAwait(false))
                {
                    lock (lockObj)
                    {
                        buffer.Append(token);
                        foundResponse = true;
                    }
                }
            }
            finally
            {
                lock (lockObj)
                {
                    streamComplete = true;
                }
            }
        }

        async Task ConsumerAsync()
        {
            while (true)
            {
                await Task.Delay(tickMs, cancellationToken).ConfigureAwait(false);

                string slice;
                bool done;
                lock (lockObj)
                {
                    var len = buffer.Length;
                    if (len == 0 && !streamComplete)
                        continue;

                    if (len > 0)
                        revealedLength = Math.Min(len, revealedLength + charsPerTick);

                    slice = revealedLength == 0 ? string.Empty : buffer.ToString(0, revealedLength);
                    done = streamComplete && revealedLength >= len;
                }

                emitContent(slice, done);
                if (done)
                    break;
            }
        }

        try
        {
            await Task.WhenAll(ProducerAsync(), ConsumerAsync()).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            lock (lockObj)
            {
                emitContent(buffer.ToString(), true);
            }

            throw;
        }

        var finalContent = buffer.ToString();
        bool found;
        lock (lockObj)
        {
            found = foundResponse;
        }

        return (found, finalContent);
    }
}
