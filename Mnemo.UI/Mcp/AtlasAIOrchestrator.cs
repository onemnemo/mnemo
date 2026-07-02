using System;
using System.Collections.Generic;
using System.Runtime.CompilerServices;
using System.Text;
using System.Threading;
using System.Threading.Channels;
using System.Threading.Tasks;
using Atlas.Core;
using Atlas.Core.Inference;
using Atlas.Core.Permissions;
using Atlas.Core.Pipeline;
using Atlas.Core.Results;
using Atlas.Core.Tasks;
using Mnemo.Core.Models;
using Mnemo.Core.Services;

namespace Mnemo.UI.Mcp;

/// <summary>
/// Adapts <see cref="IAtlasOrchestrator"/> to Mnemo's <see cref="IAIOrchestrator"/> interface.
/// Tokens stream through a channel as Atlas produces them, conversation history is
/// passed as structured turns, and tool-call lifecycle events (running → completed/failed)
/// are forwarded for live process display.
/// </summary>
public sealed class AtlasAIOrchestrator : IAIOrchestrator
{
    private readonly IAtlasOrchestrator _atlas;
    private readonly ISettingsService _settings;
    private readonly ILoggerService _logger;

    /// <summary>
    /// Full permissions for the Mnemo chat context: the user has already opened
    /// the application and consented to AI assistance, so the assistant may edit
    /// notes/mindmaps directly and search the web.
    /// </summary>
    private static readonly PermissionState MnemoFullPermissions =
        new(PermissionLevel.DirectEdit, ResourceGate.GatedExternal);

    public AtlasAIOrchestrator(IAtlasOrchestrator atlas, ISettingsService settings, ILoggerService logger)
    {
        _atlas = atlas;
        _settings = settings;
        _logger = logger;
    }

    /// <inheritdoc />
    public async Task<Result<string>> PromptAsync(
        string systemPrompt,
        string userPrompt,
        CancellationToken ct = default)
    {
        var request = new PipelineRequest(
            TaskId: TaskIds.ChatResponse,
            Input: userPrompt,
            Permissions: MnemoFullPermissions)
        {
            AgentMode = false,
            SystemPrompt = NullIfBlank(systemPrompt),
        };

        try
        {
            PipelineResult result = await _atlas.ExecuteAsync(request, ct).ConfigureAwait(false);
            return result.HasUsableOutput
                ? Result<string>.Success(result.Content!)
                : Result<string>.Failure(SummarizeFailure(result));
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.Error("AtlasAIOrchestrator", "PromptAsync failed.", ex);
            return Result<string>.Failure(ex.Message, ex);
        }
    }

    /// <inheritdoc />
    public async Task<Result<string>> PromptStructuredAsync(
        string systemPrompt,
        string userPrompt,
        object? jsonSchema = null,
        CancellationToken ct = default)
    {
        System.Collections.Immutable.ImmutableDictionary<string, string>? metadata = null;
        if (jsonSchema != null)
        {
            var schemaJson = System.Text.Json.JsonSerializer.Serialize(jsonSchema);
            metadata = System.Collections.Immutable.ImmutableDictionary<string, string>.Empty
                .Add("jsonSchema", schemaJson);
        }

        var request = new PipelineRequest(
            TaskId: TaskIds.ChatResponse,
            Input: userPrompt,
            Permissions: MnemoFullPermissions,
            Metadata: metadata)
        {
            AgentMode = false,
            SystemPrompt = NullIfBlank(systemPrompt),
        };

        try
        {
            PipelineResult result = await _atlas.ExecuteAsync(request, ct).ConfigureAwait(false);
            return result.HasUsableOutput
                ? Result<string>.Success(result.Content!)
                : Result<string>.Failure(SummarizeFailure(result));
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.Error("AtlasAIOrchestrator", "PromptStructuredAsync failed.", ex);
            return Result<string>.Failure(ex.Message, ex);
        }
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<string> PromptStreamingWithHistoryAsync(
        string systemPrompt,
        IReadOnlyList<ConversationTurn> history,
        string userMessage,
        [EnumeratorCancellation] CancellationToken ct = default,
        IProgress<string>? pipelineStatus = null,
        string? conversationRoutingKey = null,
        Action<ChatToolCall>? onToolCall = null,
        Action<string>? onAssistantReasoningUpdate = null)
    {
        pipelineStatus?.Report(ChatPipelineStatusKeys.Processing);

        var agentMode = await _settings.GetAsync("AI.AgentMode", true).ConfigureAwait(false);

        // Tokens flow pipeline-thread → channel → this iterator, so the UI sees
        // them as Atlas generates them instead of one blob at the end.
        var tokens = Channel.CreateUnbounded<string>(new UnboundedChannelOptions
        {
            SingleReader = true,
            SingleWriter = false,
        });

        var request = new PipelineRequest(
            TaskId: TaskIds.ChatResponse,
            Input: userMessage,
            Permissions: MnemoFullPermissions,
            SessionId: conversationRoutingKey)
        {
            AgentMode = agentMode,
            SystemPrompt = NullIfBlank(systemPrompt),
            History = MapHistory(history),
            OnToken = token => tokens.Writer.TryWrite(token),
            OnReasoningToken = CreateReasoningRelay(onAssistantReasoningUpdate),
            OnActivity = entry => pipelineStatus?.Report(MapActivity(entry)),
            OnToolCall = activity => onToolCall?.Invoke(MapToolCall(activity)),
        };

        // Detached from the iterator so tokens can be yielded while the pipeline
        // runs; the writer is always completed so the read loop terminates.
        Task<PipelineResult> execution = Task.Run(
            async () =>
            {
                try
                {
                    return await _atlas.ExecuteAsync(request, ct).ConfigureAwait(false);
                }
                finally
                {
                    tokens.Writer.TryComplete();
                }
            },
            CancellationToken.None);

        var streamedAnything = false;
        var cancelled = false;
        while (true)
        {
            string? token = null;
            try
            {
                if (!await tokens.Reader.WaitToReadAsync(ct).ConfigureAwait(false))
                    break;
                if (!tokens.Reader.TryRead(out token))
                    continue;
            }
            catch (OperationCanceledException)
            {
                cancelled = true;
                break;
            }

            streamedAnything = true;
            yield return token!;
        }

        PipelineResult? result = null;
        string? errorMessage = null;
        try
        {
            // Atlas honours the token cooperatively, so this settles quickly
            // after cancellation too; awaiting it observes any faults.
            result = await execution.ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            cancelled = true;
        }
        catch (Exception ex)
        {
            _logger.Error("AtlasAIOrchestrator", "PromptStreamingWithHistoryAsync failed.", ex);
            errorMessage = ex.Message;
        }

        if (cancelled)
            yield break;

        if (errorMessage != null)
        {
            yield return $"[Error: {errorMessage}]";
            yield break;
        }

        // Paths that never invoke OnToken (clarification short-circuit, repair
        // retries, non-streaming fallbacks) still deliver their content once.
        if (!streamedAnything)
        {
            yield return result!.HasUsableOutput
                ? result.Content!
                : SummarizeFailure(result);
        }
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────

    /// <summary>Maps Mnemo conversation turns onto Atlas's structured history messages.</summary>
    private static IReadOnlyList<InferenceMessage>? MapHistory(IReadOnlyList<ConversationTurn> history)
    {
        if (history.Count == 0)
            return null;

        var messages = new List<InferenceMessage>(history.Count);
        foreach (ConversationTurn turn in history)
        {
            messages.Add(turn.Role == ConversationRole.User
                ? InferenceMessage.User(turn.Content)
                : InferenceMessage.Assistant(turn.Content));
        }

        return messages;
    }

    /// <summary>
    /// Builds the reasoning relay: Atlas reports incremental reasoning tokens,
    /// Mnemo's callback expects the cumulative text. Serialized with a lock
    /// because pipeline callbacks may arrive from any thread.
    /// </summary>
    private static Action<string>? CreateReasoningRelay(Action<string>? onAssistantReasoningUpdate)
    {
        if (onAssistantReasoningUpdate == null)
            return null;

        var buffer = new StringBuilder();
        var gate = new object();
        return token =>
        {
            string snapshot;
            lock (gate)
            {
                buffer.Append(token);
                snapshot = buffer.ToString();
            }

            onAssistantReasoningUpdate(snapshot);
        };
    }

    private static ChatToolCall MapToolCall(ToolCallActivity activity) => new()
    {
        ToolCallId = activity.CallId,
        Name = activity.ToolName,
        ArgumentsJson = activity.ArgumentsJson,
        ResultContent = activity.ResultContent,
        Stage = activity.Stage switch
        {
            ToolCallStage.Started => ChatToolCallStage.Running,
            ToolCallStage.Failed => ChatToolCallStage.Failed,
            _ => ChatToolCallStage.Completed,
        },
    };

    private static string? NullIfBlank(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value;

    /// <summary>Maps an Atlas <see cref="ActivityEntry"/> to a Mnemo pipeline-status key.</summary>
    private static string MapActivity(ActivityEntry entry) => entry.Phase switch
    {
        ActivityPhase.Routing => ChatPipelineStatusKeys.Routing,
        ActivityPhase.Planning => ChatPipelineStatusKeys.Classifying,
        ActivityPhase.Searching => ChatPipelineStatusKeys.Processing,
        ActivityPhase.ExecutingTool => ChatPipelineStatusKeys.RunningTool(
            string.IsNullOrWhiteSpace(entry.Detail) ? "tool" : entry.Detail),
        ActivityPhase.Generating => ChatPipelineStatusKeys.Generating,
        _ => ChatPipelineStatusKeys.Processing,
    };

    private static string SummarizeFailure(PipelineResult result)
    {
        if (result.Warnings.IsDefaultOrEmpty)
            return "Atlas did not produce a response.";

        return result.Warnings[0].Message;
    }
}
