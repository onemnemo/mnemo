using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Diagnostics;
using System.Globalization;
using Mnemo.Core.Models;
using Mnemo.UI.ViewModels;

namespace Mnemo.UI.Services;

/// <summary>
/// Maps runtime pipeline events into a plain-language process trace for the assistant bubble.
/// Each tool call becomes its own rail row with a student-facing label (see <see cref="ChatToolVocabulary"/>);
/// mid-turn narration becomes a quiet quoted row. Answer-bookkeeping keys ("writing the answer",
/// "continuing the answer") and raw tool names are deliberately never surfaced.
/// </summary>
public sealed class ChatProcessThreadTracker
{
    private readonly ObservableCollection<ChatProcessStepViewModel> _steps;
    private readonly Dictionary<string, ChatProcessStepViewModel> _stepsByToolCallId = new(StringComparer.Ordinal);
    private readonly Stopwatch _elapsed = Stopwatch.StartNew();

    /// <summary>Elapsed wall-clock time since this tracker was created (i.e. since the turn started).</summary>
    public TimeSpan Elapsed => _elapsed.Elapsed;

    /// <summary>Label of the currently active step, or null when all are complete.</summary>
    public string? ActiveStepLabel
    {
        get
        {
            for (int i = _steps.Count - 1; i >= 0; i--)
            {
                if (_steps[i].IsActive)
                    return _steps[i].Label;
            }
            return null;
        }
    }

    public ChatProcessThreadTracker(ObservableCollection<ChatProcessStepViewModel> steps) =>
        _steps = steps;

    public void OnPipelineKey(string key, Func<string, string> localize)
    {
        if (string.IsNullOrEmpty(key))
            return;

        // Tool lifecycle arrives through AddToolCall (richer: id, args, result); ignore the status echo.
        if (ChatPipelineStatusKeys.TryParseRunningTool(key, out _))
            return;

        if (IsRoutingKey(key))
        {
            BumpRouting(localize);
            return;
        }

        if (key == ChatPipelineStatusKeys.PreparingModel)
        {
            if (LastIsActive(ChatProcessPhaseKind.Model))
                return;
            AdvanceSimple(localize(ChatPipelineStatusKeys.PreparingModel), ChatProcessPhaseKind.Model);
            return;
        }

        // "Writing the answer" / "Continuing the answer" are answer bookkeeping, not steps: never shown.
    }

    /// <summary>
    /// Records a tool-call lifecycle event as its own rail row. The <see cref="ChatToolCallStage.Running"/>
    /// event adds a spinning row with the tool's present-progressive label; the terminal event for the same
    /// call id resolves that row into a past-tense checkmark (or error) with a quiet count suffix.
    /// </summary>
    public void AddToolCall(ChatToolCall toolCall, Func<string, string> localize)
    {
        var vocab = ChatToolVocabulary.Resolve(toolCall.Name, toolCall.ArgumentsJson, toolCall.ResultContent, localize);

        if (toolCall.Stage != ChatToolCallStage.Running
            && !string.IsNullOrEmpty(toolCall.ToolCallId)
            && _stepsByToolCallId.TryGetValue(toolCall.ToolCallId, out var existingStep))
        {
            ResolveToolStep(existingStep, toolCall, vocab, localize);
            return;
        }

        CompleteActive();

        var call = new ChatToolCallViewModel
        {
            Name = toolCall.Name,
            Arguments = toolCall.ArgumentsJson ?? string.Empty,
        };

        var step = new ChatProcessStepViewModel
        {
            RunningLabel = vocab.RunningLabel,
            DoneLabel = vocab.DoneLabel,
            Detail = vocab.Chip,
            PhaseKind = ChatProcessPhaseKind.Tool,
        };
        step.ToolCalls.Add(call);

        if (toolCall.Stage == ChatToolCallStage.Running)
        {
            call.IsRunning = true;
            step.IsActive = true;
            if (!string.IsNullOrEmpty(toolCall.ToolCallId))
                _stepsByToolCallId[toolCall.ToolCallId] = step;
        }
        else
        {
            // Terminal event with no prior Running (e.g. a call rejected before execution).
            ResolveToolStep(step, toolCall, vocab, localize);
        }

        AppendStep(step);
    }

    /// <summary>Adds a quiet quoted row for mid-turn narration (prose the model emitted before calling a tool).</summary>
    public void AddNarration(string text)
    {
        if (string.IsNullOrWhiteSpace(text))
            return;

        CompleteActive();
        AppendStep(new ChatProcessStepViewModel
        {
            PhaseKind = ChatProcessPhaseKind.Narration,
            Narration = text.Trim(),
            IsComplete = true,
        });
    }

    private static void ResolveToolStep(
        ChatProcessStepViewModel step, ChatToolCall toolCall, ChatToolVocabulary.ToolStep vocab, Func<string, string> localize)
    {
        var call = step.ToolCalls.Count > 0 ? step.ToolCalls[0] : null;
        if (call is not null)
        {
            call.Result = toolCall.ResultContent ?? string.Empty;
            call.IsFailed = toolCall.Stage == ChatToolCallStage.Failed;
            call.IsRunning = false;
            call.Summary = toolCall.Stage == ChatToolCallStage.Failed
                ? localize("ToolCallFailed")
                : vocab.Suffix ?? string.Empty;
        }

        if (!string.IsNullOrEmpty(vocab.Chip))
            step.Detail = vocab.Chip;

        step.IsActive = false;
        step.IsComplete = true;
    }

    /// <summary>Appends a step and keeps <see cref="ChatProcessStepViewModel.IsLast"/> pointing at the tail.</summary>
    private void AppendStep(ChatProcessStepViewModel step)
    {
        if (_steps.Count > 0)
            _steps[^1].IsLast = false;
        _steps.Add(step);
        step.IsLast = true;
    }

    /// <summary>Marks all steps complete (call when the assistant turn ends).</summary>
    public void CompleteThread()
    {
        _elapsed.Stop();
        foreach (var s in _steps)
        {
            s.IsActive = false;
            s.IsComplete = true;
        }
    }

    /// <summary>
    /// Composes the collapsed-trace summary suffix, e.g. "used 2 tools" or "searched the web".
    /// Null when the turn ran no tools (the header then reads just "Thought for 20s").
    /// </summary>
    public string? BuildCompletionSummary(Func<string, string> localize)
    {
        var toolCount = 0;
        var webSearchCount = 0;
        foreach (var s in _steps)
        {
            if (s.PhaseKind != ChatProcessPhaseKind.Tool || s.ToolCalls.Count == 0)
                continue;
            toolCount++;
            var name = s.ToolCalls[0].Name;
            if (name is "web_search" or "search_web")
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

    /// <summary>Formats a turn duration the way the collapsed trace shows it: "20s", or "1m 5s" past a minute.</summary>
    public static string FormatShortDuration(TimeSpan elapsed)
    {
        if (elapsed.TotalSeconds < 1)
            return "0s";
        if (elapsed.TotalSeconds < 60)
            return string.Create(CultureInfo.InvariantCulture, $"{(int)elapsed.TotalSeconds}s");
        var minutes = (int)elapsed.TotalMinutes;
        var seconds = elapsed.Seconds;
        return string.Create(CultureInfo.InvariantCulture, $"{minutes}m {seconds}s");
    }

    /// <summary>Formats the live running timer as a mono clock, e.g. "00:09".</summary>
    public static string FormatRunningTimer(TimeSpan elapsed) =>
        string.Create(CultureInfo.InvariantCulture, $"{(int)elapsed.TotalMinutes:D2}:{elapsed.Seconds:D2}");

    private static bool IsRoutingKey(string key) =>
        key == ChatPipelineStatusKeys.LoadingSkills
        || key == ChatPipelineStatusKeys.Classifying
        || key == ChatPipelineStatusKeys.Routing;

    private void BumpRouting(Func<string, string> localize)
    {
        if (_steps.Count > 0)
        {
            var last = _steps[^1];
            if (last.PhaseKind == ChatProcessPhaseKind.Routing && last.IsActive)
                return;
        }

        CompleteActive();
        AppendStep(new ChatProcessStepViewModel
        {
            RunningLabel = localize("PipelineStatusRouting"),
            DoneLabel = localize("RoutingDone"),
            PhaseKind = ChatProcessPhaseKind.Routing,
            IsActive = true,
        });
    }

    private void AdvanceSimple(string label, ChatProcessPhaseKind kind)
    {
        CompleteActive();
        AppendStep(new ChatProcessStepViewModel
        {
            SimpleLabel = label,
            PhaseKind = kind,
            IsActive = true,
        });
    }

    private bool LastIsActive(ChatProcessPhaseKind kind) =>
        _steps.Count > 0 && _steps[^1].PhaseKind == kind && _steps[^1].IsActive;

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
