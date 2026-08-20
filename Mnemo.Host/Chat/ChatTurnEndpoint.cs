using System.IO;
using System.Text;
using System.Threading.Channels;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Routing;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Ai;
using Mnemo.Core.Services;
using Mnemo.Core.Services.Ai;
using Mnemo.Host.Ai;
using Mnemo.Host.Contracts;
using Mnemo.Host.Events;
using Mnemo.Infrastructure.Services.AI;
using Mnemo.UI.Services;

namespace Mnemo.Host.Chat;

/// <summary>
/// The assistant turn stream: <c>POST /api/chat/conversations/{id}/turns</c> runs one
/// agentic turn and streams the orchestrator's six signals as typed SSE events
/// (<c>delta</c>, <c>status</c>, <c>tool</c>, <c>reasoning</c>, <c>narration</c>,
/// <c>done</c>, <c>error</c>). Reveal pacing is dropped here (the SPA paces its own
/// reveal), so raw tokens go out the moment the model produces them. Cancellation is a
/// separate <c>POST /api/chat/turns/{turnId}/cancel</c> keyed on the client-minted id.
/// </summary>
public static class ChatTurnEndpoint
{
    public static void MapChatTurns(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost("/api/chat/conversations/{id}/turns", HandleTurnAsync);

        endpoints.MapPost("/api/chat/turns/{turnId}/cancel", (string turnId, ChatTurnRegistry turns) =>
            turns.Cancel(turnId) ? Results.NoContent() : Results.NotFound());
    }

    private static async Task HandleTurnAsync(
        HttpContext context,
        string id,
        ChatTurnRequestDto request,
        IAIOrchestrator orchestrator,
        IChatModuleHistoryService history,
        ChatTurnRegistry turns,
        IModelRouter modelRouter,
        ILocalizationService localization,
        IConversationMemoryStore memoryStore,
        IConversationMemoryInjector memoryInjector,
        IConversationSummarizer summarizer,
        ILoggerService logger)
    {
        var response = context.Response;
        response.Headers.CacheControl = "no-cache";
        response.Headers.ContentType = "text/event-stream";
        // Ask any intermediary (the Vite proxy in dev) not to buffer the stream.
        response.Headers["X-Accel-Buffering"] = "no";
        context.Features.Get<IHttpResponseBodyFeature>()?.DisableBuffering();

        var turnStartUtc = DateTime.UtcNow;
        Func<string, string> localize = key => localization.T(key, "Chat");

        // Prior turns feed the context window; the new user message rides in the request
        // body and is not yet persisted, so the stored messages are strictly the history.
        var load = await history.LoadAsync(context.RequestAborted).ConfigureAwait(false);
        var conversation = load.IsSuccess
            ? load.Value!.Conversations.FirstOrDefault(c => c.Id == id)
            : null;
        var priorMessages = conversation?.Messages ?? new List<ChatModulePersistedMessage>();

        // Edit-and-resend / regenerate: drop the message tail this turn replaces from the
        // context window. The same cut is re-applied at persist time (below), so history and
        // transcript stay in step; an out-of-range index means "nothing to cut" (append only).
        if (request.TruncateFromIndex is int cut && cut >= 0 && cut < priorMessages.Count)
            priorMessages = priorMessages.Take(cut).ToList();

        // Hydrate this conversation's rolling memory so the injector can fold its summary into context.
        ChatTurnMemory.Hydrate(memoryStore, logger, conversation?.MemorySnapshotJson);

        var rawHistory = ChatStreamingHelper.BuildConversationHistory(
            priorMessages, (ChatModulePersistedMessage?)null, m => m.IsUser, m => m.Content);
        var conversationHistory = await memoryInjector
            .BuildHistoryWithMemoryAsync(id, rawHistory, request.Message, context.RequestAborted)
            .ConfigureAwait(false);

        var mode = ChatStreamingHelper.NormalizeAssistantMode(request.AssistantMode);
        var systemPrompt = ChatStreamingHelper.GetSystemPromptForMode(mode);

        var registration = turns.Register(request.TurnId);
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(registration.Token, context.RequestAborted);
        var token = linked.Token;

        // The same signals stream to the SPA (which renders its own live trace) and feed the trace
        // builder, so the persisted trace is exactly what the client just watched.
        var trace = new ChatTraceBuilder();
        var outcome = new TurnOutcome();

        var channel = Channel.CreateUnbounded<AppEvent>(
            new UnboundedChannelOptions { SingleReader = true, SingleWriter = false });
        var writer = channel.Writer;

        async Task ProduceAsync()
        {
            var content = new StringBuilder();
            var foundResponse = false;
            try
            {
                IProgress<string> pipeline = new SyncProgress<string>(key =>
                {
                    trace.OnPipelineKey(key, localize);
                    writer.TryWrite(new AppEvent("status", new { key }));
                });
                Action<ChatToolCall> onTool = call =>
                {
                    trace.AddToolCall(call, localize);
                    writer.TryWrite(new AppEvent("tool", ChatToolEventDto.From(call)));
                };
                Action<string> onReasoning = text =>
                {
                    trace.SetReasoning(text);
                    writer.TryWrite(new AppEvent("reasoning", new { text }));
                };
                Action<string> onNarration = text =>
                {
                    trace.AddNarration(text);
                    writer.TryWrite(new AppEvent("narration", new { text }));
                };

                await foreach (var chunk in orchestrator.PromptStreamingWithHistoryAsync(
                    systemPrompt, conversationHistory, request.Message, token,
                    pipeline, id, onTool, onReasoning, onNarration).ConfigureAwait(false))
                {
                    if (string.IsNullOrEmpty(chunk))
                        continue;
                    content.Append(chunk);
                    foundResponse = true;
                    writer.TryWrite(new AppEvent("delta", new { text = chunk }));
                }

                outcome.Content = content.ToString();
                outcome.FoundResponse = foundResponse;

                // Empty answer + no tools = a failed turn. Probe the model route so the SPA can show
                // an actionable notice ("add your API key" / "no model bound") instead of a generic
                // apology; the orchestrator degrades a bad key/binding to an empty stream rather than
                // throwing, so this diagnosis (mirroring the desktop's post-failure route probe) is the
                // only place that distinction is recovered.
                string? failureKind = null;
                if (!foundResponse && trace.ToolCallCount == 0)
                    failureKind = await ProbeFailureKindAsync(modelRouter, token).ConfigureAwait(false);

                writer.TryWrite(new AppEvent("done",
                    new { foundResponse, content = outcome.Content, stopped = false, failureKind }));
            }
            catch (OperationCanceledException)
            {
                outcome.Content = content.ToString();
                outcome.FoundResponse = foundResponse;
                outcome.Stopped = true;
                writer.TryWrite(new AppEvent("done",
                    new { foundResponse, content = outcome.Content, stopped = true }));
            }
            catch (AiClientException ex)
            {
                outcome.Errored = true;
                writer.TryWrite(new AppEvent("error", new { kind = AiErrorMapping.ToWire(ex.Kind), message = ex.Message }));
            }
            catch (Exception ex)
            {
                outcome.Errored = true;
                writer.TryWrite(new AppEvent("error", new { kind = "unknown", message = ex.Message }));
            }
            finally
            {
                writer.TryComplete();
            }
        }

        var producer = ProduceAsync();
        try
        {
            await foreach (var evt in channel.Reader.ReadAllAsync(context.RequestAborted).ConfigureAwait(false))
                await ServerSentEvents.WriteEventAsync(response, evt, context.RequestAborted).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            // Client disconnected; the linked token stops the producer too.
        }
        finally
        {
            await producer.ConfigureAwait(false);
            turns.Complete(request.TurnId);
            await PersistTurnAsync(history, trace, localize, id, mode, turnStartUtc, request.Message, outcome,
                priorMessages, request.TruncateFromIndex, request.Attachments, memoryStore, summarizer, logger).ConfigureAwait(false);
        }
    }

    /// <summary>
    /// Writes the finished turn back. A stopped turn keeps whatever it produced (falling back to the
    /// "generation stopped" line when empty). A hard error, or an empty answer that ran no tools, is a
    /// failed turn and nothing is written: the whole (user, assistant) pair is dropped. That diverges
    /// intentionally from the desktop, which keeps the lone user message: the host persists a turn
    /// lazily as one unit at completion, so a failed turn leaves no half-written state for the SPA to
    /// reconcile or double-append when it retries. The failed turn (with the user's text) stays in the
    /// SPA's own memory until it succeeds or is dismissed.
    ///
    /// A dropped turn also skips its conversation-memory increment (memory maintenance runs past these
    /// early returns). That keeps the host self-consistent: the memory turn counter tracks exactly the
    /// persisted [user, assistant] pairs, so the summarizer's turn slicing always lines up with the
    /// stored transcript. The desktop instead counts every attempt, so after a failed turn the two apps'
    /// rolling-summary cadence drifts by one, a deliberate consequence of the lazy model, since counting
    /// a turn whose messages were never stored would eventually push the slice past the transcript.
    /// </summary>
    private static async Task PersistTurnAsync(
        IChatModuleHistoryService history,
        ChatTraceBuilder trace,
        Func<string, string> localize,
        string conversationId,
        string mode,
        DateTime turnStartUtc,
        string userMessage,
        TurnOutcome outcome,
        IReadOnlyList<ChatModulePersistedMessage> priorMessages,
        int? truncateFromIndex,
        IReadOnlyList<ChatAssetDto>? attachments,
        IConversationMemoryStore memoryStore,
        IConversationSummarizer summarizer,
        ILoggerService logger)
    {
        if (outcome.Errored)
            return;
        if (!outcome.FoundResponse && !outcome.Stopped && trace.ToolCallCount == 0)
            return;

        trace.Complete();

        var assistantContent = outcome.Content;
        if (outcome.Stopped && string.IsNullOrEmpty(assistantContent))
            assistantContent = localize("GenerationStopped");

        // The desktop collapses whitespace-only reasoning to null on a normal finish but leaves it as
        // the model emitted it when the turn was stopped mid-stream; mirror both branches.
        var thoughts = trace.Thoughts;
        if (!outcome.Stopped && string.IsNullOrWhiteSpace(thoughts))
            thoughts = null;

        var userMsg = new ChatModulePersistedMessage
        {
            Content = userMessage,
            IsUser = true,
            TimestampUtc = turnStartUtc,
            Attachments = BuildAttachments(attachments),
        };

        var steps = trace.BuildPersistedSteps();
        var assistantMsg = new ChatModulePersistedMessage
        {
            Content = assistantContent,
            IsUser = false,
            TimestampUtc = turnStartUtc,
            Thoughts = thoughts,
            ThoughtsCount = trace.ThoughtsCount,
            ProcessHeaderText = localize("ThoughtFor"),
            ElapsedText = ChatProcessThreadTracker.FormatShortDuration(trace.Elapsed),
            ProcessSummaryText = trace.BuildCompletionSummary(localize),
            ProcessSteps = steps.Count == 0 ? null : steps,
        };

        // Post-turn memory: advance the turn counter and roll up a fresh summary when due, off the full
        // transcript this turn just extended. Runs after the stream has drained (the client already has
        // its answer), so its latency doesn't delay the visible reply.
        var transcript = new List<ChatModulePersistedMessage>(priorMessages) { userMsg, assistantMsg };
        var fullTranscript = ChatStreamingHelper.BuildFullConversationHistory(
            transcript, m => m.IsUser, m => m.Content);
        var memorySnapshotJson = await ChatTurnMemory
            .RunPostTurnAsync(memoryStore, summarizer, logger, conversationId, fullTranscript)
            .ConfigureAwait(false);

        // Last-activity reflects turn COMPLETION (the desktop stamps it after streaming), so the
        // sidebar sort and day-bucketing land the same in either app.
        await ChatTurnPersistence.AppendTurnAsync(
                history, conversationId, mode, DateTime.UtcNow, userMsg, assistantMsg, memorySnapshotJson, truncateFromIndex)
            .ConfigureAwait(false);
    }

    /// <summary>
    /// Resolves why an empty turn produced nothing: a missing API key or an unbound model becomes a
    /// specific, actionable notice kind for the SPA; anything else (or a probe failure) is null, so the
    /// client falls back to the generic apology. The strings are the SPA's own notice-kind vocabulary.
    /// </summary>
    private static async Task<string?> ProbeFailureKindAsync(IModelRouter modelRouter, CancellationToken ct)
    {
        try
        {
            var route = await modelRouter.ResolveChatAsync(AiRole.Assistant, ct).ConfigureAwait(false);
            return route.Status switch
            {
                AiRouteStatus.MissingApiKey => "missing_api_key",
                AiRouteStatus.NoBinding => "model_unavailable",
                _ => null,
            };
        }
        catch
        {
            return null;
        }
    }

    /// <summary>
    /// Maps the client's uploaded-asset references to persisted attachments, dropping any whose
    /// id is malformed or whose file is missing so the message never records a dangling reference.
    /// Kind is re-derived from the extension server-side rather than trusting the client's claim.
    /// </summary>
    private static List<ChatModulePersistedAttachment>? BuildAttachments(IReadOnlyList<ChatAssetDto>? attachments)
    {
        if (attachments is null || attachments.Count == 0)
            return null;

        List<ChatModulePersistedAttachment>? result = null;
        foreach (var asset in attachments)
        {
            var path = ChatAssetStore.ResolvePath(asset.AssetId);
            if (path is null || !File.Exists(path))
                continue;

            result ??= new List<ChatModulePersistedAttachment>();
            result.Add(new ChatModulePersistedAttachment
            {
                Path = path,
                Kind = ChatAssetStore.KindForExtension(Path.GetExtension(path)),
                DisplayName = asset.DisplayName,
            });
        }

        return result;
    }

    /// <summary>Turn result captured by the producer and read once the stream has drained.</summary>
    private sealed class TurnOutcome
    {
        public string Content = string.Empty;
        public bool FoundResponse;
        public bool Stopped;
        public bool Errored;
    }

    /// <summary>An <see cref="IProgress{T}"/> that runs its handler inline, preserving the order
    /// of pipeline-status reports relative to the tokens and tool events around them (the default
    /// <see cref="Progress{T}"/> would post to a captured context and reorder).</summary>
    private sealed class SyncProgress<T>(Action<T> handler) : IProgress<T>
    {
        public void Report(T value) => handler(value);
    }
}
