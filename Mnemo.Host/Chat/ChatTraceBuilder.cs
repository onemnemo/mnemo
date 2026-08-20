using System.Diagnostics;
using Mnemo.Core.Models;
using Mnemo.UI.Services;

namespace Mnemo.Host.Chat;

/// <summary>
/// Headless reconstruction of the assistant process trace, kept byte-compatible with the
/// desktop app's <c>ChatProcessThreadTracker</c> + <c>ChatViewModel</c> so a turn saved by the
/// host reopens identically in either UI. It consumes the same streaming signals the orchestrator
/// emits (pipeline keys, tool-call lifecycle, mid-turn narration, reasoning) and produces the
/// persisted trace fields directly: no view-model layer. Every mutating call is serialized, since
/// the orchestrator's callbacks can arrive off the request thread.
/// </summary>
public sealed class ChatTraceBuilder
{
    /// <summary>One rail row. Mirrors <c>ChatProcessStepViewModel</c>; carries at most one tool call, as the tracker does.</summary>
    private sealed class Step
    {
        public string RunningLabel = string.Empty;
        public string? DoneLabel;
        public string? Detail;
        public string? Narration;
        public string PhaseKind = "Routing";
        public bool IsComplete;
        public bool IsActive;
        public ToolEntry? Tool;

        // Past tense once complete, present-progressive while active: exactly the view-model rule.
        public string Label => IsComplete && !string.IsNullOrEmpty(DoneLabel) ? DoneLabel! : RunningLabel;
    }

    private sealed class ToolEntry
    {
        public string Name = string.Empty;
        public string Arguments = string.Empty;
        public string Result = string.Empty;
        public string Summary = string.Empty;
    }

    private readonly object _gate = new();
    private readonly List<Step> _steps = new();
    private readonly Dictionary<string, Step> _stepsByToolCallId = new(StringComparer.Ordinal);
    private readonly HashSet<string> _seenToolCallIds = new(StringComparer.Ordinal);
    private readonly Stopwatch _elapsed = Stopwatch.StartNew();

    /// <summary>Distinct tool calls this turn (drives the "answer was empty but tools ran" persistence branch).</summary>
    public int ToolCallCount { get; private set; }

    /// <summary>Tool + narration count, matching the desktop's <c>ThoughtsCount</c>.</summary>
    public int ThoughtsCount { get; private set; }

    /// <summary>Final reasoning text (null when the model emitted none).</summary>
    public string? Thoughts { get; private set; }

    public TimeSpan Elapsed => _elapsed.Elapsed;

    /// <summary>Routing / model-prep advancement. Tool lifecycle and answer bookkeeping are deliberately ignored here.</summary>
    public void OnPipelineKey(string key, Func<string, string> localize)
    {
        if (string.IsNullOrEmpty(key))
            return;

        // Tool lifecycle arrives through AddToolCall (richer: id, args, result); ignore the status echo.
        if (ChatPipelineStatusKeys.TryParseRunningTool(key, out _))
            return;

        lock (_gate)
        {
            if (IsRoutingKey(key))
            {
                BumpRouting(localize);
                return;
            }

            if (key == ChatPipelineStatusKeys.PreparingModel)
            {
                if (LastIsActive("Model"))
                    return;
                AdvanceSimple(localize(ChatPipelineStatusKeys.PreparingModel), "Model");
            }

            // "Writing/continuing the answer" are answer bookkeeping, never steps.
        }
    }

    /// <summary>Records a tool-call lifecycle event: a Running event opens an active row; the terminal event resolves it.</summary>
    public void AddToolCall(ChatToolCall toolCall, Func<string, string> localize)
    {
        var vocab = ChatToolVocabulary.Resolve(toolCall.Name, toolCall.ArgumentsJson, toolCall.ResultContent, localize);

        lock (_gate)
        {
            // Count once per distinct call: the same id surfaces twice (Running then terminal).
            var isNewCall = string.IsNullOrEmpty(toolCall.ToolCallId)
                ? toolCall.Stage == ChatToolCallStage.Running
                : _seenToolCallIds.Add(toolCall.ToolCallId);
            if (isNewCall)
            {
                ToolCallCount++;
                ThoughtsCount++;
            }

            if (toolCall.Stage != ChatToolCallStage.Running
                && !string.IsNullOrEmpty(toolCall.ToolCallId)
                && _stepsByToolCallId.TryGetValue(toolCall.ToolCallId, out var existingStep))
            {
                ResolveToolStep(existingStep, toolCall, vocab, localize);
                return;
            }

            CompleteActive();

            var step = new Step
            {
                RunningLabel = vocab.RunningLabel,
                DoneLabel = vocab.DoneLabel,
                Detail = vocab.Chip,
                PhaseKind = "Tool",
                Tool = new ToolEntry { Name = toolCall.Name, Arguments = toolCall.ArgumentsJson ?? string.Empty },
            };

            if (toolCall.Stage == ChatToolCallStage.Running)
            {
                step.IsActive = true;
                if (!string.IsNullOrEmpty(toolCall.ToolCallId))
                    _stepsByToolCallId[toolCall.ToolCallId] = step;
            }
            else
            {
                ResolveToolStep(step, toolCall, vocab, localize);
            }

            _steps.Add(step);
        }
    }

    /// <summary>Adds a quiet quoted row for mid-turn narration. Counts the event even when the text is blank, as the desktop does.</summary>
    public void AddNarration(string text)
    {
        lock (_gate)
        {
            ThoughtsCount++;
            if (string.IsNullOrWhiteSpace(text))
                return;

            CompleteActive();
            _steps.Add(new Step
            {
                PhaseKind = "Narration",
                Narration = text.Trim(),
                IsComplete = true,
            });
        }
    }

    /// <summary>Latest full reasoning text (the orchestrator replaces, not appends).</summary>
    public void SetReasoning(string reasoning) =>
        Thoughts = string.IsNullOrEmpty(reasoning) ? null : reasoning;

    /// <summary>
    /// Freezes the elapsed timer and marks every step complete. Call once the turn ends. Whether
    /// whitespace-only reasoning collapses to null depends on how the turn ended, so that decision
    /// is left to the caller (the desktop collapses it on a normal finish but not on a stop).
    /// </summary>
    public void Complete()
    {
        lock (_gate)
        {
            _elapsed.Stop();
            foreach (var s in _steps)
            {
                s.IsActive = false;
                s.IsComplete = true;
            }
        }
    }

    /// <summary>Snapshots the trace as persisted process steps (empty when nothing was recorded).</summary>
    public List<ChatModulePersistedProcessStep> BuildPersistedSteps()
    {
        lock (_gate)
        {
            return _steps.Select(s => new ChatModulePersistedProcessStep
            {
                Label = s.Label,
                Detail = s.Detail,
                Narration = s.Narration,
                PhaseKind = s.PhaseKind,
                IsComplete = s.IsComplete,
                ToolCalls = s.Tool is null
                    ? null
                    : new List<ChatModulePersistedToolCallEntry>
                    {
                        new()
                        {
                            Name = s.Tool.Name,
                            Arguments = s.Tool.Arguments,
                            Result = s.Tool.Result,
                            Summary = s.Tool.Summary,
                        },
                    },
            }).ToList();
        }
    }

    /// <summary>Collapsed-trace summary suffix ("used 2 tools" / "searched the web"), or null when no tools ran.</summary>
    public string? BuildCompletionSummary(Func<string, string> localize)
    {
        lock (_gate)
        {
            var toolCount = 0;
            var webSearchCount = 0;
            foreach (var s in _steps)
            {
                if (s.PhaseKind != "Tool" || s.Tool is null)
                    continue;
                toolCount++;
                if (s.Tool.Name is "web_search" or "search_web")
                    webSearchCount++;
            }

            if (toolCount == 0)
                return null;
            if (webSearchCount == toolCount)
                return localize("SummaryWebSearch");
            return toolCount == 1
                ? localize("SummaryUsedOneTool")
                : string.Format(localize("SummaryUsedTools"), toolCount);
        }
    }

    private static void ResolveToolStep(Step step, ChatToolCall toolCall, ChatToolVocabulary.ToolStep vocab, Func<string, string> localize)
    {
        if (step.Tool is { } call)
        {
            call.Result = toolCall.ResultContent ?? string.Empty;
            call.Summary = toolCall.Stage == ChatToolCallStage.Failed
                ? localize("ToolCallFailed")
                : vocab.Suffix ?? string.Empty;
        }

        if (!string.IsNullOrEmpty(vocab.Chip))
            step.Detail = vocab.Chip;

        step.IsActive = false;
        step.IsComplete = true;
    }

    private static bool IsRoutingKey(string key) =>
        key == ChatPipelineStatusKeys.LoadingSkills
        || key == ChatPipelineStatusKeys.Classifying
        || key == ChatPipelineStatusKeys.Routing;

    private void BumpRouting(Func<string, string> localize)
    {
        if (_steps.Count > 0)
        {
            var last = _steps[^1];
            if (last.PhaseKind == "Routing" && last.IsActive)
                return;
        }

        CompleteActive();
        _steps.Add(new Step
        {
            RunningLabel = localize("PipelineStatusRouting"),
            DoneLabel = localize("RoutingDone"),
            PhaseKind = "Routing",
            IsActive = true,
        });
    }

    private void AdvanceSimple(string label, string phaseKind)
    {
        CompleteActive();
        _steps.Add(new Step
        {
            RunningLabel = label,
            DoneLabel = label,
            PhaseKind = phaseKind,
            IsActive = true,
        });
    }

    private bool LastIsActive(string phaseKind) =>
        _steps.Count > 0 && _steps[^1].PhaseKind == phaseKind && _steps[^1].IsActive;

    private void CompleteActive()
    {
        foreach (var s in _steps)
        {
            if (!s.IsActive)
                continue;
            s.IsActive = false;
            s.IsComplete = true;
        }
    }
}
