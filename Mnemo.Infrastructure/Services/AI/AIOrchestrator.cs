using System;
using System.Collections.Generic;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Channels;
using System.Threading.Tasks;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Ai;
using Mnemo.Core.Services;
using Mnemo.Core.Services.Ai;

namespace Mnemo.Infrastructure.Services.AI;

/// <summary>
/// Mnemo-owned application-facing AI orchestrator. Resolves the assistant model through the
/// <see cref="IModelRouter"/>, drives the agentic tool-calling loop over an
/// <see cref="IChatModelClient"/>, and adapts provider deltas into the flat token / callback
/// shape the chat UI consumes.
/// </summary>
public sealed class AIOrchestrator : IAIOrchestrator
{
    // Bounds a single agentic turn so a model that keeps requesting tools can't loop forever.
    private const int MaxToolCallRounds = 6;

    private readonly IModelRouter _router;
    private readonly IAiToolGateway _toolGateway;
    private readonly ISettingsService _settings;
    private readonly ILoggerService _logger;

    public AIOrchestrator(IModelRouter router, IAiToolGateway toolGateway, ISettingsService settings, ILoggerService logger)
    {
        _router = router;
        _toolGateway = toolGateway;
        _settings = settings;
        _logger = logger;
    }

    /// <inheritdoc />
    public Task<Result<string>> PromptAsync(string systemPrompt, string userPrompt, AiRole role = AiRole.Assistant, CancellationToken ct = default)
        => CompleteAsync(systemPrompt, userPrompt, responseSchema: null, role, ct);

    /// <inheritdoc />
    public Task<Result<string>> PromptStructuredAsync(string systemPrompt, string userPrompt, object? jsonSchema = null, AiRole role = AiRole.Assistant, CancellationToken ct = default)
        => CompleteAsync(systemPrompt, userPrompt, BuildResponseSchema(jsonSchema), role, ct);

    /// <inheritdoc />
    public async IAsyncEnumerable<string> PromptStreamingWithHistoryAsync(
        string systemPrompt,
        IReadOnlyList<ConversationTurn> history,
        string userMessage,
        [EnumeratorCancellation] CancellationToken ct = default,
        IProgress<string>? pipelineStatus = null,
        string? conversationRoutingKey = null,
        Action<ChatToolCall>? onToolCall = null,
        Action<string>? onAssistantReasoningUpdate = null,
        Action<string>? onAssistantNarration = null)
    {
        // C# forbids `yield return` inside a try/catch, so a background producer owns all error
        // handling and the visible tokens flow back through an unbounded channel. Unbounded means
        // the producer never blocks on a write, so abandoning enumeration early can't deadlock it.
        var channel = Channel.CreateUnbounded<string>(new UnboundedChannelOptions
        {
            SingleReader = true,
            SingleWriter = true,
        });

        using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        var producer = ProduceStreamAsync(
            channel.Writer,
            systemPrompt,
            history,
            userMessage,
            pipelineStatus,
            conversationRoutingKey,
            onToolCall,
            onAssistantReasoningUpdate,
            onAssistantNarration,
            linkedCts.Token);

        try
        {
            await foreach (var token in channel.Reader.ReadAllAsync(ct).ConfigureAwait(false))
            {
                yield return token;
            }
        }
        finally
        {
            // If the consumer stopped early, cancel the producer; then observe it so it is never orphaned.
            linkedCts.Cancel();
            await producer.ConfigureAwait(false);
        }
    }

    /// <summary>
    /// Runs the agentic loop and reports its outcome through the channel: normal completion on
    /// success or a swallowed provider failure, and completion carrying the exception for
    /// cancellation or anything unexpected (so it surfaces to the consumer rather than being lost).
    /// Always completes the writer exactly once, so awaiting this task never faults.
    /// </summary>
    private async Task ProduceStreamAsync(
        ChannelWriter<string> writer,
        string systemPrompt,
        IReadOnlyList<ConversationTurn> history,
        string userMessage,
        IProgress<string>? pipelineStatus,
        string? conversationRoutingKey,
        Action<ChatToolCall>? onToolCall,
        Action<string>? onAssistantReasoningUpdate,
        Action<string>? onAssistantNarration,
        CancellationToken ct)
    {
        try
        {
            await RunStreamRoundsAsync(
                writer, systemPrompt, history, userMessage,
                pipelineStatus, conversationRoutingKey, onToolCall, onAssistantReasoningUpdate, onAssistantNarration, ct)
                .ConfigureAwait(false);
            writer.Complete();
        }
        catch (AiClientException ex)
        {
            // A terminal provider failure ends the turn quietly — consumers already render the empty-response case.
            _logger.Error("AIOrchestrator", $"Chat stream failed ({ex.Kind}): {ex.Message}", ex);
            writer.Complete();
        }
        catch (Exception ex)
        {
            // Cancellation and any unexpected fault surface to the consumer via the channel's completion.
            writer.Complete(ex);
        }
    }

    private async Task RunStreamRoundsAsync(
        ChannelWriter<string> writer,
        string systemPrompt,
        IReadOnlyList<ConversationTurn> history,
        string userMessage,
        IProgress<string>? pipelineStatus,
        string? conversationRoutingKey,
        Action<ChatToolCall>? onToolCall,
        Action<string>? onAssistantReasoningUpdate,
        Action<string>? onAssistantNarration,
        CancellationToken ct)
    {
        // When a narration sink is supplied, mid-turn visible text (prose emitted in a round that then
        // calls tools) is routed there rather than into the answer stream, so the yielded tokens are only
        // the final post-tool text block. A round's disposition (narration vs answer) is known only once
        // its stream ends, so in this mode a round's content is buffered and released at the round boundary
        // instead of streamed live; the terminal answer still reveals progressively via the UI pacing.
        var divertNarration = onAssistantNarration is not null;

        var route = await _router.ResolveChatAsync(AiRole.Assistant, ct).ConfigureAwait(false);
        if (route is not { Status: AiRouteStatus.Available, Binding: { } binding })
        {
            _logger.Warning("AIOrchestrator", $"No assistant model available ({route.Status}); ending the turn with no response.");
            return;
        }

        var tools = await ResolveToolsAsync(ct).ConfigureAwait(false);

        var messages = new List<ChatMessage>();
        if (!string.IsNullOrWhiteSpace(systemPrompt))
        {
            messages.Add(ChatMessage.System(systemPrompt));
        }
        foreach (var turn in history)
        {
            messages.Add(turn.Role == ConversationRole.Assistant
                ? ChatMessage.Assistant(turn.Content)
                : ChatMessage.User(turn.Content));
        }
        messages.Add(ChatMessage.User(userMessage));

        pipelineStatus?.Report(ChatPipelineStatusKeys.Generating);

        // Reasoning accumulates across the whole turn; the UI expects the full text on every update.
        var reasoning = new StringBuilder();

        for (var round = 0; round < MaxToolCallRounds; round++)
        {
            var request = new ChatRequest
            {
                ModelId = binding.ModelId,
                // Snapshot so each recorded round carries the message list as it stood then.
                Messages = messages.ToArray(),
                Tools = tools,
            };

            var visibleText = new StringBuilder();
            var toolCalls = new List<ToolCallRequest>();

            await foreach (var delta in binding.Client.StreamAsync(request, ct).ConfigureAwait(false))
            {
                switch (delta)
                {
                    case ChatStreamDelta.Content content when content.Text.Length > 0:
                        visibleText.Append(content.Text);
                        // In diversion mode we can't stream yet: this text is only known to be the answer
                        // (vs narration) once the round ends. It is released after the round below.
                        if (!divertNarration)
                            writer.TryWrite(content.Text);
                        break;
                    case ChatStreamDelta.Reasoning reasoningDelta:
                        reasoning.Append(reasoningDelta.Text);
                        onAssistantReasoningUpdate?.Invoke(reasoning.ToString());
                        break;
                    case ChatStreamDelta.ToolCall toolCall:
                        // Collect the round's calls; they are dispatched once the stream for this round finishes.
                        toolCalls.Add(toolCall.Call);
                        break;
                    // Usage and Finish carry no Phase-0 action.
                }
            }

            if (toolCalls.Count == 0)
            {
                // Terminal round: its visible text is the answer. In diversion mode it was buffered, so
                // release it now for the UI to reveal; in legacy mode it was already streamed live.
                if (divertNarration && visibleText.Length > 0)
                    writer.TryWrite(visibleText.ToString());
                return;
            }

            // This round called tools, so any visible text it produced is narration, not the answer.
            if (divertNarration && visibleText.Length > 0)
                onAssistantNarration!.Invoke(visibleText.ToString());

            messages.Add(ChatMessage.AssistantToolCalls(toolCalls, visibleText.Length > 0 ? visibleText.ToString() : null));

            foreach (var call in toolCalls)
            {
                pipelineStatus?.Report(ChatPipelineStatusKeys.RunningTool(call.Name));
                onToolCall?.Invoke(new ChatToolCall
                {
                    ToolCallId = call.Id,
                    Name = call.Name,
                    ArgumentsJson = call.ArgumentsJson,
                    Stage = ChatToolCallStage.Running,
                });

                var result = await _toolGateway
                    .DispatchAsync(call, new ToolDispatchScope(conversationRoutingKey), ct)
                    .ConfigureAwait(false);

                onToolCall?.Invoke(new ChatToolCall
                {
                    ToolCallId = call.Id,
                    Name = call.Name,
                    ArgumentsJson = call.ArgumentsJson,
                    ResultContent = result.Content,
                    Stage = ChatToolCallStage.Completed,
                });

                messages.Add(ChatMessage.ToolResult(result));
            }

            pipelineStatus?.Report(ChatPipelineStatusKeys.ContinuingAfterTool);
        }

        _logger.Warning("AIOrchestrator", $"Reached the tool-call round cap ({MaxToolCallRounds}); stopping the turn.");
    }

    /// <summary>
    /// Resolves the tool set for this turn. Tools are only offered when agent mode is on, and a
    /// tool-manifest failure degrades to "no tools" (logged) rather than failing the chat turn.
    /// </summary>
    private async Task<IReadOnlyList<ChatToolDefinition>?> ResolveToolsAsync(CancellationToken ct)
    {
        var agentMode = await _settings.GetAsync("AI.AgentMode", true).ConfigureAwait(false);
        if (!agentMode)
        {
            return null;
        }

        try
        {
            var definitions = await _toolGateway.GetToolDefinitionsAsync(ct).ConfigureAwait(false);
            return definitions.Count > 0 ? definitions : null;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.Warning("AIOrchestrator", $"Tool definitions unavailable; continuing without tools. {ex.Message}");
            return null;
        }
    }

    /// <summary>Shared single-shot completion path for <see cref="PromptAsync"/> and <see cref="PromptStructuredAsync"/>.</summary>
    private async Task<Result<string>> CompleteAsync(string systemPrompt, string userPrompt, ChatResponseSchema? responseSchema, AiRole role, CancellationToken ct)
    {
        var route = await _router.ResolveChatAsync(role, ct).ConfigureAwait(false);
        if (route is not { Status: AiRouteStatus.Available, Binding: { } binding })
        {
            return Result<string>.Failure($"No assistant model is available ({route.Status}).");
        }

        var messages = new List<ChatMessage>();
        if (!string.IsNullOrWhiteSpace(systemPrompt))
        {
            messages.Add(ChatMessage.System(systemPrompt));
        }
        messages.Add(ChatMessage.User(userPrompt));

        var request = new ChatRequest
        {
            ModelId = binding.ModelId,
            Messages = messages,
            ResponseSchema = responseSchema,
        };

        var buffer = new StringBuilder();
        try
        {
            await foreach (var delta in binding.Client.StreamAsync(request, ct).ConfigureAwait(false))
            {
                if (delta is ChatStreamDelta.Content content)
                {
                    buffer.Append(content.Text);
                }
            }
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (AiClientException ex)
        {
            _logger.Error("AIOrchestrator", $"Prompt failed ({ex.Kind}): {ex.Message}", ex);
            return Result<string>.Failure(ex.Message, ex);
        }

        return buffer.Length > 0
            ? Result<string>.Success(buffer.ToString())
            : Result<string>.Failure("The model returned no content.");
    }

    /// <summary>
    /// Normalizes a caller-supplied schema (JSON string, <see cref="JsonElement"/>,
    /// <see cref="JsonDocument"/>, or a POCO) into a <see cref="ChatResponseSchema"/>.
    /// </summary>
    private static ChatResponseSchema? BuildResponseSchema(object? jsonSchema)
    {
        if (jsonSchema is null)
        {
            return null;
        }

        JsonElement element;
        switch (jsonSchema)
        {
            case JsonElement el:
                element = el.Clone();
                break;
            case JsonDocument doc:
                element = doc.RootElement.Clone();
                break;
            case string json:
                using (var parsed = JsonDocument.Parse(json))
                {
                    element = parsed.RootElement.Clone();
                }
                break;
            default:
                element = JsonSerializer.SerializeToElement(jsonSchema);
                break;
        }

        return new ChatResponseSchema("response", element);
    }
}
