using System;
using System.Collections.ObjectModel;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Input;
using Avalonia.Threading;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.UI.Services;
using Mnemo.UI.ViewModels;

namespace Mnemo.UI.Components.RightSidebar;

public partial class RightSidebarViewModel : ViewModelBase
{
    public const string AiAssistantEnabledKey = "AI.EnableAssistant";

    public const double MinWidth = 300;
    public const double MaxWidth = 480;
    public const double DefaultWidth = 320;
    /// <summary>Width of the resize handle; overlay so it does not reduce main content area.</summary>
    public const double ResizeHandleWidth = 12;

    private readonly IAIOrchestrator _orchestrator;
    private readonly ILoggerService _logger;
    private readonly ILocalizationService _localizationService;
    private readonly ISettingsService _settingsService;
    private readonly ISkillSystemPromptComposer _skillSystemPromptComposer;
    private readonly ChatTypingPrefetchHelper _typingPrefetch;

    private string _conversationId = Guid.NewGuid().ToString("N");
    private int _turnIndex;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(EffectiveWidth))]
    [NotifyPropertyChangedFor(nameof(LayoutWidth))]
    private double _expandedWidth = DefaultWidth;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(EffectiveWidth))]
    [NotifyPropertyChangedFor(nameof(LayoutWidth))]
    [NotifyPropertyChangedFor(nameof(ShowFloatingOpenButton))]
    [NotifyPropertyChangedFor(nameof(ShowResizeHandle))]
    private bool _isCollapsed = true;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(ShowFloatingOpenButton))]
    [NotifyPropertyChangedFor(nameof(ShowResizeHandle))]
    private bool _isAiAssistantEnabled;

    public bool ShowFloatingOpenButton => IsAiAssistantEnabled && IsCollapsed;

    public bool ShowResizeHandle => IsAiAssistantEnabled && !IsCollapsed;

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(SendCommand))]
    [NotifyCanExecuteChangedFor(nameof(StopCommand))]
    private string _inputText = string.Empty;

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(SendCommand))]
    [NotifyCanExecuteChangedFor(nameof(StopCommand))]
    private bool _isBusy;

    /// <summary>Available assistant modes for the mode dropdown.</summary>
    public IReadOnlyList<string> AssistantModes { get; } = new[] { "Short", "Normal", "Detailed" };

    [ObservableProperty]
    private string _selectedAssistantMode = "Normal";

    public ObservableCollection<ChatMessage> Messages { get; } = new();

    public double EffectiveWidth => IsCollapsed ? 0 : ExpandedWidth;

    /// <summary>Width used for layout.</summary>
    public double LayoutWidth => IsCollapsed ? 0 : ExpandedWidth - ResizeHandleWidth;

    public ICommand ToggleCommand { get; }
    public AsyncRelayCommand SendCommand { get; }
    public RelayCommand StopCommand { get; }
    public RelayCommand NewChatCommand { get; }
    public ICommand SuggestionSelectedCommand { get; }

    private CancellationTokenSource? _cts;

    public RightSidebarViewModel(IAIOrchestrator orchestrator, ILoggerService logger, ILocalizationService localizationService, ISettingsService settingsService, ISkillSystemPromptComposer skillSystemPromptComposer, ChatPauseToSendEstimator pauseToSendEstimator)
    {
        _orchestrator = orchestrator;
        _logger = logger;
        _localizationService = localizationService;
        _settingsService = settingsService;
        _skillSystemPromptComposer = skillSystemPromptComposer;
        _typingPrefetch = new ChatTypingPrefetchHelper(pauseToSendEstimator);

        ToggleCommand = new RelayCommand(() =>
        {
            if (!IsAiAssistantEnabled)
                return;
            IsCollapsed = !IsCollapsed;
        });
        SendCommand = new AsyncRelayCommand(SendAsync, () => !string.IsNullOrWhiteSpace(InputText) && !IsBusy);
        StopCommand = new RelayCommand(StopGeneration, () => IsBusy);
        NewChatCommand = new RelayCommand(NewChat);
        SuggestionSelectedCommand = new RelayCommand<string>(ApplySuggestion);

        IsAiAssistantEnabled = _settingsService.GetAsync(AiAssistantEnabledKey, false).GetAwaiter().GetResult();
        _settingsService.SettingChanged += OnSettingsChanged;

        Messages.Add(CreateWelcomeMessage());
    }

    private void OnSettingsChanged(object? sender, string key)
    {
        if (key != AiAssistantEnabledKey)
            return;
        IsAiAssistantEnabled = _settingsService.GetAsync(AiAssistantEnabledKey, false).GetAwaiter().GetResult();
        if (!IsAiAssistantEnabled)
            IsCollapsed = true;
    }

    private ChatMessage CreateWelcomeMessage()
    {
        return new ChatMessage
        {
            Role = MessageRole.Assistant,
            Content = _localizationService.T("WelcomeMessage", "Chat"),
            Suggestions = new List<string>
            {
                _localizationService.T("SuggestionExplain", "Chat"),
                _localizationService.T("SuggestionQuiz", "Chat"),
                _localizationService.T("SuggestionSummarize", "Chat")
            }
        };
    }

    partial void OnInputTextChanged(string value)
    {
        _typingPrefetch.NotifyInputChanged(IsBusy, isRecording: false);
    }

    private void StopGeneration()
    {
        _cts?.Cancel();
    }

    private void NewChat()
    {
        if (IsBusy)
            StopGeneration();
        _conversationId = Guid.NewGuid().ToString("N");
        _turnIndex = 0;
        Messages.Clear();
        Messages.Add(CreateWelcomeMessage());
    }

    private void ApplySuggestion(string? suggestion)
    {
        if (!string.IsNullOrEmpty(suggestion))
            InputText = suggestion;
    }

    private async Task SendAsync()
    {
        if (string.IsNullOrWhiteSpace(InputText) || IsBusy) return;

        var userMessage = InputText;
        InputText = string.Empty;

        Messages.Add(new ChatMessage
        {
            Role = MessageRole.User,
            Content = userMessage
        });

        IsBusy = true;

        var aiMessage = new ChatMessage
        {
            Role = MessageRole.Assistant,
            Content = string.Empty,
            IsStreaming = true
        };
        Messages.Add(aiMessage);

        _ = _typingPrefetch.RecordSendPauseAsync();

        _cts = new CancellationTokenSource();

        var streamingConversationId = _conversationId;
        var streamingAssistantMode = SelectedAssistantMode;
        var historyMessages = Messages.ToList();
        _turnIndex++;

        var conversationHistory = ChatStreamingHelper.BuildConversationHistory(
            historyMessages, aiMessage, m => m.IsUser, m => m.Content,
            excludeLastUserTurn: true);

        var toolCallCount = 0;

        ChatProcessThreadTracker? processThread = null;
        try
        {
            processThread = new ChatProcessThreadTracker(aiMessage.ProcessSteps);

            IProgress<string> pipelineProgress = new Progress<string>(key =>
                Dispatcher.UIThread.Post(() =>
                {
                    processThread!.OnPipelineKey(key, k => _localizationService.T(k, "Chat"));
                    UpdateProcessHeader(aiMessage, processThread);
                }, DispatcherPriority.Background));

            void UpdateContent(string content) =>
                Dispatcher.UIThread.Post(() => { aiMessage.Content = content; }, DispatcherPriority.Background);

            void UpdateReasoning(string reasoning) =>
                Dispatcher.UIThread.Post(() =>
                {
                    aiMessage.Thoughts = string.IsNullOrEmpty(reasoning) ? null : reasoning;
                }, DispatcherPriority.Background);

            var baseSystemPrompt = ChatStreamingHelper.GetSystemPromptForMode(streamingAssistantMode);

            var reveal = await _settingsService.GetAsync("Chat.StreamingReveal", "balanced").ConfigureAwait(false);
            var displayOptions = ChatStreamingDisplayOptions.Parse(reveal);

            Action<ChatToolCall> onToolCall = tc =>
            {
                toolCallCount++;
                Dispatcher.UIThread.Post(() =>
                {
                    processThread?.AddToolCall(tc, k => _localizationService.T(k, "Chat"));
                    aiMessage.ThoughtsCount += 1;
                }, DispatcherPriority.Background);
            };

            var (foundResponse, finalContent) = await ChatStreamingHelper.RunStreamingWithHistoryAsync(
                _orchestrator,
                baseSystemPrompt,
                conversationHistory,
                userMessage,
                _cts.Token,
                UpdateContent,
                pipelineProgress,
                conversationRoutingKey: streamingConversationId,
                displayOptions,
                onToolCall,
                onAssistantReasoningUpdate: UpdateReasoning);

            await Dispatcher.UIThread.InvokeAsync(() =>
            {
                aiMessage.Content = finalContent;
                if (string.IsNullOrWhiteSpace(aiMessage.Thoughts))
                    aiMessage.Thoughts = null;
                processThread?.CompleteThread();
                FinalizeProcessHeader(aiMessage, processThread);
                aiMessage.PipelineStatusText = null;
                aiMessage.IsStreaming = false;
            });

            if (!foundResponse && toolCallCount == 0)
            {
                await Dispatcher.UIThread.InvokeAsync(() =>
                    aiMessage.Content = _localizationService.T("ErrorSorry", "Chat"));
            }
        }
        catch (OperationCanceledException)
        {
            await Dispatcher.UIThread.InvokeAsync(() =>
            {
                if (string.IsNullOrEmpty(aiMessage.Content))
                    aiMessage.Content = _localizationService.T("GenerationStopped", "Chat");
                processThread?.CompleteThread();
                FinalizeProcessHeader(aiMessage, processThread);
                aiMessage.PipelineStatusText = null;
                aiMessage.IsStreaming = false;
            });
        }
        catch (Exception ex)
        {
            _logger.Error("RightSidebar", $"Send failed: {ex}");
            await Dispatcher.UIThread.InvokeAsync(() =>
            {
                aiMessage.Content = _localizationService.T("ErrorUnexpected", "Chat");
                processThread?.CompleteThread();
                FinalizeProcessHeader(aiMessage, processThread);
                aiMessage.PipelineStatusText = null;
                aiMessage.IsStreaming = false;
            });
        }
        finally
        {
            var cts = _cts;
            _cts = null;
            cts?.Dispose();
            Dispatcher.UIThread.Post(() => IsBusy = false);
        }
    }

    private static void UpdateProcessHeader(ChatMessage message, ChatProcessThreadTracker tracker)
    {
        var e = tracker.Elapsed;
        message.ElapsedText = $"{(int)e.TotalMinutes:D2}:{e.Seconds:D2}";
        message.ProcessHeaderText = tracker.ActiveStepLabel ?? "Thinking…";
    }

    private static void FinalizeProcessHeader(ChatMessage message, ChatProcessThreadTracker? tracker)
    {
        if (tracker == null) return;
        var e = tracker.Elapsed;
        message.ElapsedText = $"{(int)e.TotalMinutes:D2}:{e.Seconds:D2}";
        var steps = message.ThoughtsCount;
        message.ProcessHeaderText = steps > 0
            ? $"Thought process ({steps} steps)"
            : "Thought process";
    }
}
