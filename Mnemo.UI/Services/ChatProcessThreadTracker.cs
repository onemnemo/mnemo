using System;
using System.Collections.ObjectModel;
using System.Diagnostics;
using Mnemo.Core.Models;
using Mnemo.UI.ViewModels;

namespace Mnemo.UI.Services;

/// <summary>
/// Maps pipeline status keys into a linear process thread for the assistant bubble.
/// </summary>
public sealed class ChatProcessThreadTracker
{
    private readonly ObservableCollection<ChatProcessStepViewModel> _steps;
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

        if (ChatPipelineStatusKeys.TryParseRunningTool(key, out var toolName))
        {
            Advance(
                localize("PipelineStatusRunningTool"),
                ChatProcessPhaseKind.Tool,
                toolName);
            return;
        }

        if (IsRoutingKey(key))
        {
            BumpRouting(localize);
            return;
        }

        if (key == ChatPipelineStatusKeys.PreparingModel)
        {
            if (LastIsActive(ChatProcessPhaseKind.Model))
                return;
            Advance(localize(ChatPipelineStatusKeys.PreparingModel), ChatProcessPhaseKind.Model);
            return;
        }

        if (key == ChatPipelineStatusKeys.Generating)
        {
            if (LastIsActive(ChatProcessPhaseKind.Generating))
                return;
            Advance(localize(ChatPipelineStatusKeys.Generating), ChatProcessPhaseKind.Generating);
            return;
        }

        if (key == ChatPipelineStatusKeys.ContinuingAfterTool)
        {
            Advance(localize(ChatPipelineStatusKeys.ContinuingAfterTool), ChatProcessPhaseKind.Continuing);
            return;
        }
    }

    public void AddToolCall(ChatToolCall toolCall, Func<string, string> localize)
    {
        if (_steps.Count == 0) return;
        var last = _steps[^1];

        var summary = BuildToolSummary(toolCall);

        last.ToolCalls.Add(new ChatToolCallViewModel
        {
            Name = toolCall.Name,
            Arguments = toolCall.ArgumentsJson ?? string.Empty,
            Result = toolCall.ResultContent ?? string.Empty,
            Summary = summary
        });
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

    private static string BuildToolSummary(ChatToolCall toolCall)
    {
        var result = toolCall.ResultContent;
        if (string.IsNullOrWhiteSpace(result))
            return "completed";

        var lineCount = 1;
        foreach (var ch in result)
        {
            if (ch == '\n') lineCount++;
        }

        if (lineCount > 3)
            return $"{lineCount} lines returned";

        if (result.Length > 80)
            return $"{result.Length} chars returned";

        return "completed";
    }

    private static bool IsRoutingKey(string key) =>
        key == ChatPipelineStatusKeys.LoadingSkills
        || key == ChatPipelineStatusKeys.Classifying
        || key == ChatPipelineStatusKeys.Routing;

    private void BumpRouting(Func<string, string> localize)
    {
        var label = localize(ChatPipelineStatusKeys.RoutingCombined);
        if (_steps.Count > 0)
        {
            var last = _steps[^1];
            if (last.PhaseKind == ChatProcessPhaseKind.Routing && last.IsActive)
            {
                last.Label = label;
                return;
            }
        }

        CompleteActive();
        _steps.Add(new ChatProcessStepViewModel
        {
            Label = label,
            PhaseKind = ChatProcessPhaseKind.Routing,
            IsActive = true,
            IsComplete = false
        });
    }

    private void Advance(string label, ChatProcessPhaseKind kind, string? detail = null)
    {
        CompleteActive();
        _steps.Add(new ChatProcessStepViewModel
        {
            Label = label,
            Detail = detail,
            PhaseKind = kind,
            IsActive = true,
            IsComplete = false
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
