using System;
using System.Collections.Generic;
using System.Runtime.CompilerServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Atlas.Core;
using Atlas.Core.Permissions;
using Atlas.Core.Pipeline;
using Atlas.Core.Results;
using Atlas.Core.Tasks;
using Mnemo.Core.Models;
using Mnemo.Core.Services;

namespace Mnemo.UI.Mcp;

/// <summary>
/// Adapts <see cref="IAtlasOrchestrator"/> to Mnemo's <see cref="IAIOrchestrator"/> interface.
/// History is folded into the prompt by serializing <see cref="ConversationTurn"/>s into a compact
/// text prefix so Atlas's <see cref="PipelineRequest.Input"/> carries full context.
/// </summary>
/// <remarks>
/// TODO: Replace FoldHistory with structured Atlas history once Atlas exposes a typed history API.
/// </remarks>
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

        // Fold history into the input: Atlas's PipelineRequest takes a single Input
        // string, so we serialize prior turns as a compact prefix the model can read.
        // TODO: Replace with structured Atlas history API when available.
        string input = FoldHistory(history, userMessage);

        string? finalContent = null;
        var request = new PipelineRequest(
            TaskId: TaskIds.ChatResponse,
            Input: input,
            Permissions: MnemoFullPermissions,
            SessionId: conversationRoutingKey)
        {
            AgentMode = agentMode,
            OnToken = token => finalContent = (finalContent ?? string.Empty) + token,
            OnActivity = entry => pipelineStatus?.Report(MapActivity(entry)),
        };

        PipelineResult? result = null;
        string? errorMessage = null;
        bool cancelled = false;
        try
        {
            result = await _atlas.ExecuteAsync(request, ct).ConfigureAwait(false);
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

        string content = result!.HasUsableOutput
            ? result.Content!
            : SummarizeFailure(result);

        yield return content;
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────

    /// <summary>
    /// Folds multi-turn history into the Atlas <c>Input</c> string.
    /// Format: one line per turn "<c>User: ...</c>" / "<c>Assistant: ...</c>",
    /// then the new user message on the last line.
    /// </summary>
    private static string FoldHistory(IReadOnlyList<ConversationTurn> history, string userMessage)
    {
        if (history.Count == 0)
            return userMessage;

        var sb = new StringBuilder();
        foreach (ConversationTurn turn in history)
        {
            string role = turn.Role == ConversationRole.User ? "User" : "Assistant";
            sb.Append(role).Append(": ").AppendLine(turn.Content);
        }

        sb.Append("User: ").Append(userMessage);
        return sb.ToString();
    }

    /// <summary>Maps an Atlas <see cref="ActivityEntry"/> to a Mnemo pipeline-status key.</summary>
    private static string MapActivity(ActivityEntry entry) => entry.Phase switch
    {
        ActivityPhase.Routing => ChatPipelineStatusKeys.Routing,
        ActivityPhase.Searching => ChatPipelineStatusKeys.Processing,
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
