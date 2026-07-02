using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Input;
using Avalonia.Threading;
using CommunityToolkit.Mvvm.Input;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.UI.Services;
using Mnemo.UI.ViewModels;

namespace Mnemo.UI.Ai.Overlay;

/// <summary>
/// Drives the compact "Ask" overlay. A lightweight, self-contained conversation surface that
/// shares the streaming engine (<see cref="ChatStreamingHelper"/>) and status thread
/// (<see cref="ChatProcessThreadTracker"/>) with the full chat module, but keeps its own
/// ephemeral in-memory history so it can be summoned anywhere without touching chat storage.
/// </summary>
public sealed class AskOverlayViewModel : ViewModelBase
{
    private readonly IAIOrchestrator _orchestrator;
    private readonly ILocalizationService _localization;
    private readonly string _sessionId = Guid.NewGuid().ToString("N");

    private CancellationTokenSource? _cts;
    private string? _pendingSeedContext;

    /// <summary>Raised when the overlay should be dismissed.</summary>
    public event Action? CloseRequested;

    /// <summary>Raised when the user wants to continue in the full chat module.</summary>
    public event Action<string?>? PopOutRequested;

    public ObservableCollection<AskTurnViewModel> Turns { get; } = new();

    public AskOverlayViewModel(IAIOrchestrator orchestrator, ILocalizationService localization)
    {
        _orchestrator = orchestrator;
        _localization = localization;

        SendCommand = new RelayCommand(() => _ = SendAsync());
        StopCommand = new RelayCommand(() => _cts?.Cancel());
        CloseCommand = new RelayCommand(() => CloseRequested?.Invoke());
        PopOutCommand = new RelayCommand(() => PopOutRequested?.Invoke(LastQuestion));
    }

    public ICommand SendCommand { get; }
    public ICommand StopCommand { get; }
    public ICommand CloseCommand { get; }
    public ICommand PopOutCommand { get; }

    private string _inputText = string.Empty;
    public string InputText
    {
        get => _inputText;
        set => SetProperty(ref _inputText, value);
    }

    private bool _isBusy;
    public bool IsBusy
    {
        get => _isBusy;
        set
        {
            if (SetProperty(ref _isBusy, value))
                OnPropertyChanged(nameof(CanSend));
        }
    }

    private bool _hasTurns;
    public bool HasTurns
    {
        get => _hasTurns;
        set
        {
            if (SetProperty(ref _hasTurns, value))
                OnPropertyChanged(nameof(ShowEmptyState));
        }
    }

    public bool ShowEmptyState => !HasTurns;

    public bool CanSend => !IsBusy;

    private string? LastQuestion => Turns.Count > 0 ? Turns[^1].Question : InputText;

    /// <summary>Pre-fills / pre-sends the overlay (selection context, preset prompt).</summary>
    public void Seed(string? context, string? prompt, bool autoSend)
    {
        _pendingSeedContext = string.IsNullOrWhiteSpace(context) ? null : context;
        if (!string.IsNullOrWhiteSpace(prompt))
            InputText = prompt;

        if (autoSend && (!string.IsNullOrWhiteSpace(prompt) || _pendingSeedContext != null))
            _ = SendAsync();
    }

    private async Task SendAsync()
    {
        if (IsBusy)
            return;

        var question = (InputText ?? string.Empty).Trim();
        if (string.IsNullOrEmpty(question) && _pendingSeedContext == null)
            return;

        InputText = string.Empty;

        string seedContext = _pendingSeedContext ?? string.Empty;
        _pendingSeedContext = null;

        string displayQuestion = string.IsNullOrEmpty(question)
            ? _localization.T("AskExplainThis", "Chat")
            : question;
        string userMessage = BuildUserMessage(question, seedContext);

        var turn = new AskTurnViewModel { Question = displayQuestion, IsStreaming = true };
        var history = BuildHistory();
        Turns.Add(turn);
        HasTurns = true;

        IsBusy = true;
        _cts = new CancellationTokenSource();

        var tracker = new ChatProcessThreadTracker(turn.ProcessSteps);
        turn.ProcessSteps.CollectionChanged += (_, _) =>
        {
            turn.HasProcess = turn.ProcessSteps.Count > 0;
            UpdateHeader(turn, tracker);
        };

        IProgress<string> pipelineProgress = new Progress<string>(key =>
        {
            tracker.OnPipelineKey(key, k => _localization.T(k, "Chat"));
            UpdateHeader(turn, tracker);
        });

        Action<ChatToolCall> onToolCall = tc => Dispatcher.UIThread.Post(() =>
            tracker.AddToolCall(tc, k => _localization.T(k, "Chat")));

        try
        {
            var (found, final) = await ChatStreamingHelper.RunStreamingWithHistoryAsync(
                _orchestrator,
                ChatStreamingHelper.NormalSystemPrompt,
                history,
                userMessage,
                _cts.Token,
                content => Dispatcher.UIThread.Post(() => turn.Content = content),
                pipelineProgress,
                conversationRoutingKey: _sessionId,
                displayOptions: null,
                onToolCall: onToolCall,
                onAssistantReasoningUpdate: null).ConfigureAwait(true);

            if (!found || string.IsNullOrWhiteSpace(final))
                turn.Content = _localization.T("AssistantNoResponse", "Chat");
        }
        catch (OperationCanceledException)
        {
            if (string.IsNullOrEmpty(turn.Content))
                turn.Content = _localization.T("GenerationStopped", "Chat");
        }
        catch (Exception ex)
        {
            turn.Content = $"[{ex.Message}]";
        }
        finally
        {
            tracker.CompleteThread();
            turn.IsStreaming = false;
            UpdateHeader(turn, tracker);
            IsBusy = false;
            _cts?.Dispose();
            _cts = null;
        }
    }

    private List<ConversationTurn> BuildHistory()
    {
        var history = new List<ConversationTurn>();
        foreach (var t in Turns)
        {
            if (!string.IsNullOrWhiteSpace(t.Question))
                history.Add(new ConversationTurn(ConversationRole.User, t.Question));
            if (!string.IsNullOrWhiteSpace(t.Content))
                history.Add(new ConversationTurn(ConversationRole.Assistant, t.Content));
        }

        int max = ChatStreamingHelper.MaxContextMessageCount;
        if (history.Count > max)
            history.RemoveRange(0, history.Count - max);
        return history;
    }

    private void UpdateHeader(AskTurnViewModel turn, ChatProcessThreadTracker tracker)
    {
        turn.ElapsedText = FormatElapsed(tracker.Elapsed);
        if (turn.IsStreaming)
        {
            turn.ProcessHeaderText = tracker.ActiveStepLabel
                ?? _localization.T("PipelineStatusGenerating", "Chat");
        }
        else
        {
            int n = turn.ProcessSteps.Count;
            string baseLabel = _localization.T("ThoughtProcess", "Chat");
            turn.ProcessHeaderText = n > 0 ? $"{baseLabel} · {n}" : baseLabel;
        }
    }

    private static string FormatElapsed(TimeSpan elapsed)
    {
        double seconds = elapsed.TotalSeconds;
        return seconds < 1 ? string.Empty : $"{seconds:0.0}s";
    }

    private static string BuildUserMessage(string question, string context)
    {
        if (string.IsNullOrWhiteSpace(context))
            return question;
        if (string.IsNullOrWhiteSpace(question))
            return context;
        return $"Context (selected text):\n\"\"\"\n{context}\n\"\"\"\n\n{question}";
    }
}
