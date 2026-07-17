using System.Text;
using System.Threading.Channels;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Routing;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Ai;
using Mnemo.Core.Services;
using Mnemo.Host.Contracts;
using Mnemo.Host.Events;
using Mnemo.UI.Services;

namespace Mnemo.Host.Chat;

/// <summary>
/// The assistant turn stream: <c>POST /api/chat/conversations/{id}/turns</c> runs one
/// agentic turn and streams the orchestrator's six signals as typed SSE events
/// (<c>delta</c>, <c>status</c>, <c>tool</c>, <c>reasoning</c>, <c>narration</c>,
/// <c>done</c>, <c>error</c>). Reveal pacing is dropped here — the SPA paces its own
/// reveal — so raw tokens go out the moment the model produces them. Cancellation is a
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
        ChatTurnRegistry turns)
    {
        var response = context.Response;
        response.Headers.CacheControl = "no-cache";
        response.Headers.ContentType = "text/event-stream";
        // Ask any intermediary (the Vite proxy in dev) not to buffer the stream.
        response.Headers["X-Accel-Buffering"] = "no";
        context.Features.Get<IHttpResponseBodyFeature>()?.DisableBuffering();

        // Prior turns feed the context window; the new user message rides in the request
        // body and is not yet persisted, so the stored messages are strictly the history.
        var load = await history.LoadAsync(context.RequestAborted).ConfigureAwait(false);
        var priorMessages = (load.IsSuccess
            ? load.Value!.Conversations.FirstOrDefault(c => c.Id == id)?.Messages
            : null) ?? new List<ChatModulePersistedMessage>();

        var conversationHistory = ChatStreamingHelper.BuildConversationHistory(
            priorMessages, (ChatModulePersistedMessage?)null, m => m.IsUser, m => m.Content);

        var mode = ChatStreamingHelper.NormalizeAssistantMode(request.AssistantMode);
        var systemPrompt = ChatStreamingHelper.GetSystemPromptForMode(mode);

        var registration = turns.Register(request.TurnId);
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(registration.Token, context.RequestAborted);
        var token = linked.Token;

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
                    writer.TryWrite(new AppEvent("status", new { key })));
                Action<ChatToolCall> onTool = call =>
                    writer.TryWrite(new AppEvent("tool", ChatToolEventDto.From(call)));
                Action<string> onReasoning = text =>
                    writer.TryWrite(new AppEvent("reasoning", new { text }));
                Action<string> onNarration = text =>
                    writer.TryWrite(new AppEvent("narration", new { text }));

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

                writer.TryWrite(new AppEvent("done",
                    new { foundResponse, content = content.ToString(), stopped = false }));
            }
            catch (OperationCanceledException)
            {
                writer.TryWrite(new AppEvent("done",
                    new { foundResponse, content = content.ToString(), stopped = true }));
            }
            catch (AiClientException ex)
            {
                writer.TryWrite(new AppEvent("error", new { kind = MapErrorKind(ex.Kind), message = ex.Message }));
            }
            catch (Exception ex)
            {
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
        }
    }

    private static string MapErrorKind(AiClientErrorKind kind) => kind switch
    {
        AiClientErrorKind.InvalidApiKey => "invalid_api_key",
        AiClientErrorKind.InsufficientCredits => "insufficient_credits",
        AiClientErrorKind.RateLimited => "rate_limited",
        AiClientErrorKind.ModelUnavailable => "model_unavailable",
        AiClientErrorKind.Network => "network",
        AiClientErrorKind.Timeout => "timeout",
        AiClientErrorKind.InvalidRequest => "invalid_request",
        _ => "unknown",
    };

    /// <summary>An <see cref="IProgress{T}"/> that runs its handler inline, preserving the order
    /// of pipeline-status reports relative to the tokens and tool events around them (the default
    /// <see cref="Progress{T}"/> would post to a captured context and reorder).</summary>
    private sealed class SyncProgress<T>(Action<T> handler) : IProgress<T>
    {
        public void Report(T value) => handler(value);
    }
}
