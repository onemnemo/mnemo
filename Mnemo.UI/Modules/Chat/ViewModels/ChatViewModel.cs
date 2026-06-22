using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Collections.Specialized;
using System.ComponentModel;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Input;
using Avalonia;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Input.Platform;
using Avalonia.Layout;
using Avalonia.Threading;
using CommunityToolkit.Mvvm.Input;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.UI.Components.Overlays;
using Mnemo.UI.Services;
using Mnemo.UI.ViewModels;

namespace Mnemo.UI.Modules.Chat.ViewModels;

public class ChatViewModel : ViewModelBase, INavigationAware, IDisposable
{
    /// <summary>Distance from bottom (px) below which we consider "at bottom" for scroll-to-bottom button.</summary>
    public const double ScrollToBottomThreshold = 20;

    private static readonly ICommand NoOpAttachmentCommand = new RelayCommand<ChatAttachmentViewModel>(_ => { });

    private static readonly HashSet<string> ImageExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"
    };

    /// <summary>Number of turns between automatic summarizations.</summary>
    private const int SummarizationInterval = 3;

    private readonly IAIOrchestrator _orchestrator;
    private readonly ILoggerService _logger;
    private readonly ILocalizationService _localizationService;
    private readonly IOverlayService _overlayService;
    private readonly ISpeechRecognitionService _speechService;
    private readonly ISettingsService _settingsService;
    private readonly ISkillSystemPromptComposer _skillSystemPromptComposer;
    private readonly ChatTypingPrefetchHelper _typingPrefetch;
    private readonly IChatModuleHistoryService _chatHistoryService;
    private readonly IChatHistoryClearService _chatHistoryClearService;
    private readonly IConversationMemoryStore _memoryStore;
    private readonly IConversationSummarizer _memorySummarizer;
    private readonly IConversationMemoryInjector _memoryInjector;

    private string _conversationId = string.Empty;

    private bool _historyLoadStarted;
    private bool _isHistoryReady;
    private bool _isChatHistorySidebarOpen = true;
    private readonly Dictionary<string, ChatSession> _chatSessions = new();
    private readonly ObservableCollection<ChatMessageViewModel> _ephemeralMessages = new();
    private bool _isEphemeralConversation;
    private ObservableCollection<ChatMessageViewModel>? _messagesSubscriptionTarget;
    private bool _disposed;

    private string _welcomeIntroText = string.Empty;

    /// <summary>Zero-based turn counter within the current conversation, incremented each time a user message is sent.</summary>
    private int _turnIndex;

    /// <summary>When recording started, if append mode: content that was in the input before dictation.</summary>
    private string _inputTextBeforeRecording = string.Empty;
    private bool _wipeInputForDictation;

    private string _inputText = string.Empty;
    public string InputText
    {
        get => _inputText;
        set
        {
            if (SetProperty(ref _inputText, value))
            {
                ((AsyncRelayCommand)SendMessageCommand).NotifyCanExecuteChanged();
                _typingPrefetch.NotifyInputChanged(IsBusy, IsRecording);
            }
        }
    }

    private bool _isBusy;
    public bool IsBusy
    {
        get => _isBusy;
        set
        {
            if (SetProperty(ref _isBusy, value))
            {
                ((AsyncRelayCommand)SendMessageCommand).NotifyCanExecuteChanged();
                ((RelayCommand)StopCommand).NotifyCanExecuteChanged();
                OnPropertyChanged(nameof(CanUseChatActions));
                OnPropertyChanged(nameof(CanSwitchChatHistory));
                DeleteChatCommand.NotifyCanExecuteChanged();
                RenameChatCommand.NotifyCanExecuteChanged();
                RegenerateAssistantMessageCommand.NotifyCanExecuteChanged();
            }
        }
    }

    private bool _showScrollToBottomButton;
    /// <summary>True when the user has scrolled up and the "Scroll to bottom" button should be visible.</summary>
    public bool ShowScrollToBottomButton
    {
        get => _showScrollToBottomButton;
        set => SetProperty(ref _showScrollToBottomButton, value);
    }

    /// <summary>When true, new content (e.g. streaming) will auto-scroll to bottom. Becomes false when user scrolls up; restored when user clicks "Scroll to bottom".</summary>
    private bool _isAutoScrollAttached = true;

    private readonly ObservableCollection<ChatMessageViewModel> _emptyMessages = new();

    /// <summary>Messages for the active conversation (empty collection until history has loaded).</summary>
    public ObservableCollection<ChatMessageViewModel> Messages =>
        _isEphemeralConversation
            ? _ephemeralMessages
            : !string.IsNullOrEmpty(_conversationId) && _chatSessions.TryGetValue(_conversationId, out var session)
                ? session.Messages
                : _emptyMessages;

    public ObservableCollection<ChatConversationRowViewModel> ConversationRows { get; } = new();

    /// <summary>Localized welcome copy for the intro panel (not part of <see cref="Messages"/>).</summary>
    public string WelcomeIntroText
    {
        get => _welcomeIntroText;
        private set => SetProperty(ref _welcomeIntroText, value);
    }

    /// <summary>Suggestion chips for the welcome intro panel.</summary>
    public ObservableCollection<string> WelcomeSuggestionList { get; } = new();

    /// <summary>True when the empty-state welcome + suggestions should show (no user messages in the thread yet).</summary>
    public bool ShowWelcomeIntro => _isHistoryReady && !Messages.Any(m => m.IsUser);

    private bool _showMemoryPill;
    /// <summary>True when this thread has working memory, a rolling summary, or long-term recall.</summary>
    public bool ShowMemoryPill
    {
        get => _showMemoryPill;
        private set => SetProperty(ref _showMemoryPill, value);
    }

    private string _memoryPillDisplayText = string.Empty;
    /// <summary>Short label for the memory pill (e.g. “Memory · 3”).</summary>
    public string MemoryPillDisplayText
    {
        get => _memoryPillDisplayText;
        private set => SetProperty(ref _memoryPillDisplayText, value);
    }

    private string _memoryPillTooltipText = string.Empty;
    /// <summary>Full memory snapshot for hover tooltip.</summary>
    public string MemoryPillTooltipText
    {
        get => _memoryPillTooltipText;
        private set => SetProperty(ref _memoryPillTooltipText, value);
    }

    public bool IsChatHistorySidebarOpen
    {
        get => _isChatHistorySidebarOpen;
        set
        {
            if (SetProperty(ref _isChatHistorySidebarOpen, value))
                OnPropertyChanged(nameof(ChatHistorySidebarWidth));
        }
    }

    public double ChatHistorySidebarWidth => IsChatHistorySidebarOpen ? 272 : 48;

    /// <summary>Available assistant modes for the mode dropdown.</summary>
    public IReadOnlyList<string> AssistantModes { get; } = new[] { "Short", "Normal", "Detailed" };

    private string _selectedAssistantMode = "Normal";
    public string SelectedAssistantMode
    {
        get => ActiveSession?.AssistantMode ?? _selectedAssistantMode;
        set
        {
            var session = ActiveSession;
            if (session != null)
            {
                if (session.AssistantMode == value) return;
                session.AssistantMode = value;
                OnPropertyChanged();
            }
            else
            {
                SetProperty(ref _selectedAssistantMode, value);
            }
        }
    }

    public ObservableCollection<ChatAttachmentViewModel> PendingAttachments { get; } = new();

    public ICommand SendMessageCommand { get; }
    public ICommand StopCommand { get; }
    public ICommand NewChatCommand { get; }
    public ICommand ToggleChatHistorySidebarCommand { get; }
    public ICommand SuggestionSelectedCommand { get; }
    public ICommand ScrollToBottomCommand { get; }
    public ICommand RemoveAttachmentCommand { get; }
    public ICommand OpenImagePreviewCommand { get; }
    public ICommand StartRecordingCommand { get; }
    public ICommand StopRecordingCommand { get; }
    public ICommand CancelRecordingCommand { get; }

    public AsyncRelayCommand<ChatMessageViewModel> RegenerateAssistantMessageCommand { get; }
    public AsyncRelayCommand<ChatMessageViewModel> CopyAssistantMessageCommand { get; }

    public IAsyncRelayCommand<string> DeleteChatCommand { get; }
    public IRelayCommand<string> RenameChatCommand { get; }

    /// <summary>True when chat actions that must not overlap generation (e.g. regenerate) are allowed.</summary>
    public bool CanUseChatActions => !IsBusy && !IsRecording;

    /// <summary>True when the user can switch threads or start a new chat from the history sidebar (streaming is cancelled on navigation).</summary>
    public bool CanNavigateChatHistory => !IsRecording && _isHistoryReady;

    /// <summary>True when history actions that must not overlap generation (delete, rename) are allowed.</summary>
    public bool CanSwitchChatHistory => !IsBusy && !IsRecording && _isHistoryReady;

    /// <summary>Raised when the view should scroll to the end (e.g. after new message or user clicked "Scroll to bottom").</summary>
    public event EventHandler? RequestScrollToBottom;

    private CancellationTokenSource? _cts;
    private ChatMessageViewModel? _lastMessageSubscribed;
    private CancellationTokenSource? _recordingDurationCts;
    /// <summary>Coalesces <see cref="RequestScrollToBottom"/> during token streaming so ScrollToEnd/layout does not run on every content tick.</summary>
    private DispatcherTimer? _scrollToBottomDebounceTimer;

    private bool _isRecording;
    public bool IsRecording
    {
        get => _isRecording;
        set
        {
            if (SetProperty(ref _isRecording, value))
            {
                OnPropertyChanged(nameof(WatermarkText));
                ((AsyncRelayCommand)StartRecordingCommand).NotifyCanExecuteChanged();
                ((AsyncRelayCommand)StopRecordingCommand).NotifyCanExecuteChanged();
                ((AsyncRelayCommand)CancelRecordingCommand).NotifyCanExecuteChanged();
                ((AsyncRelayCommand)SendMessageCommand).NotifyCanExecuteChanged();
                OnPropertyChanged(nameof(CanUseChatActions));
                OnPropertyChanged(nameof(CanNavigateChatHistory));
                OnPropertyChanged(nameof(CanSwitchChatHistory));
                DeleteChatCommand.NotifyCanExecuteChanged();
                RenameChatCommand.NotifyCanExecuteChanged();
                RegenerateAssistantMessageCommand.NotifyCanExecuteChanged();
            }
        }
    }

    public string WatermarkText => IsRecording 
        ? _localizationService.T("Listening", "Chat") 
        : _localizationService.T("AskPlaceholder", "Chat");

    private TimeSpan _recordingDuration;
    public string RecordingDurationText => _recordingDuration.ToString(@"mm\:ss");

    private ChatSession? ActiveSession =>
        !string.IsNullOrEmpty(_conversationId) && _chatSessions.TryGetValue(_conversationId, out var s) ? s : null;

    public ChatViewModel(
        IAIOrchestrator orchestrator,
        ILoggerService logger,
        ILocalizationService localizationService,
        IOverlayService overlayService,
        ISpeechRecognitionService speechService,
        ISettingsService settingsService,
        ISkillSystemPromptComposer skillSystemPromptComposer,
        ChatPauseToSendEstimator pauseToSendEstimator,
        IChatModuleHistoryService chatHistoryService,
        IChatHistoryClearService chatHistoryClearService,
        IConversationMemoryStore memoryStore,
        IConversationSummarizer memorySummarizer,
        IConversationMemoryInjector memoryInjector)
    {
        _orchestrator = orchestrator;
        _logger = logger;
        _localizationService = localizationService;
        _overlayService = overlayService;
        _speechService = speechService;
        _settingsService = settingsService;
        _skillSystemPromptComposer = skillSystemPromptComposer;
        _chatHistoryService = chatHistoryService;
        _chatHistoryClearService = chatHistoryClearService;
        _chatHistoryClearService.Cleared += OnChatHistoryClearServiceCleared;
        _memoryStore = memoryStore;
        _memorySummarizer = memorySummarizer;
        _memoryInjector = memoryInjector;
        _typingPrefetch = new ChatTypingPrefetchHelper(pauseToSendEstimator);

        SendMessageCommand = new AsyncRelayCommand(SendMessageAsync, () => !string.IsNullOrWhiteSpace(InputText) && !IsBusy && !IsRecording && _isHistoryReady);
        StopCommand = new RelayCommand(StopGeneration, () => IsBusy);
        NewChatCommand = new RelayCommand(NewChat, () => !IsRecording && _isHistoryReady);
        ToggleChatHistorySidebarCommand = new RelayCommand(() => IsChatHistorySidebarOpen = !IsChatHistorySidebarOpen);
        SuggestionSelectedCommand = new RelayCommand<string>(ApplySuggestion);
        ScrollToBottomCommand = new RelayCommand(OnScrollToBottom);
        RemoveAttachmentCommand = new RelayCommand<ChatAttachmentViewModel>(a =>
        {
            if (a != null)
                PendingAttachments.Remove(a);
        });
        OpenImagePreviewCommand = new RelayCommand<string>(OpenImagePreview);

        StartRecordingCommand = new AsyncRelayCommand(StartRecordingAsync, () => !IsBusy && !IsRecording);
        StopRecordingCommand = new AsyncRelayCommand(StopRecordingAsync, () => IsRecording);
        CancelRecordingCommand = new AsyncRelayCommand(CancelRecordingAsync, () => IsRecording);

        RegenerateAssistantMessageCommand = new AsyncRelayCommand<ChatMessageViewModel>(RegenerateAssistantMessageAsync, CanRegenerateAssistantMessage);
        CopyAssistantMessageCommand = new AsyncRelayCommand<ChatMessageViewModel>(CopyAssistantMessageAsync);

        DeleteChatCommand = new AsyncRelayCommand<string>(DeleteChatAsync, CanModifyChat);
        RenameChatCommand = new RelayCommand<string>(BeginRenameChat, CanModifyChat);

        RefreshLocalizedWelcomeUi();
        OnPropertyChanged(nameof(WatermarkText));
    }

    private void RefreshLocalizedWelcomeUi()
    {
        WelcomeIntroText = _localizationService.T("WelcomeMessage", "Chat");
        WelcomeSuggestionList.Clear();
        WelcomeSuggestionList.Add(_localizationService.T("SuggestionExplain", "Chat"));
        WelcomeSuggestionList.Add(_localizationService.T("SuggestionQuiz", "Chat"));
        WelcomeSuggestionList.Add(_localizationService.T("SuggestionSummarize", "Chat"));
    }

    private void NotifyShowWelcomeIntroChanged() => OnPropertyChanged(nameof(ShowWelcomeIntro));

    /// <inheritdoc />
    public void OnNavigatedTo(object? parameter)
    {
        if (_historyLoadStarted) return;
        _historyLoadStarted = true;
        _ = LoadHistoryAsync();
    }

    private void OnPartialTranscript(string text)
    {
        Dispatcher.UIThread.Post(() =>
        {
            InputText = _wipeInputForDictation
                ? text
                : string.IsNullOrWhiteSpace(_inputTextBeforeRecording)
                    ? text
                    : _inputTextBeforeRecording + (string.IsNullOrWhiteSpace(text) ? "" : " " + text);
        });
    }

    private async Task StartRecordingAsync()
    {
        if (IsRecording) return;
        _wipeInputForDictation = await _settingsService.GetAsync("Chat.WipeInputForDictation", false).ConfigureAwait(false);
        _inputTextBeforeRecording = _wipeInputForDictation ? string.Empty : InputText;
        try
        {
            await _speechService.StartRecordingAsync(CancellationToken.None, OnPartialTranscript).ConfigureAwait(false);
            await Dispatcher.UIThread.InvokeAsync(() =>
            {
                IsRecording = true;
                _recordingDuration = TimeSpan.Zero;
                OnPropertyChanged(nameof(RecordingDurationText));

                _recordingDurationCts = new CancellationTokenSource();
                var ct = _recordingDurationCts.Token;
                _ = Task.Run(async () =>
                {
                    try
                    {
                        while (!ct.IsCancellationRequested)
                        {
                            await Task.Delay(TimeSpan.FromSeconds(1), ct).ConfigureAwait(false);
                            if (ct.IsCancellationRequested) break;
                            Dispatcher.UIThread.Post(() =>
                            {
                                _recordingDuration = _recordingDuration.Add(TimeSpan.FromSeconds(1));
                                OnPropertyChanged(nameof(RecordingDurationText));
                            });
                        }
                    }
                    catch (OperationCanceledException) { }
                }, CancellationToken.None);
            });
        }
        catch (Exception ex)
        {
            _logger.Error("Chat", $"Failed to start recording: {ex}");
        }
    }

    private async Task StopRecordingAsync()
    {
        if (!IsRecording) return;

        _recordingDurationCts?.Cancel();
        _recordingDurationCts?.Dispose();
        _recordingDurationCts = null;
        IsRecording = false;

        IsBusy = true;
        try
        {
            var result = await _speechService.StopAndTranscribeAsync(CancellationToken.None).ConfigureAwait(false);
            await Dispatcher.UIThread.InvokeAsync(() =>
            {
                if (result.IsSuccess && !string.IsNullOrWhiteSpace(result.Value))
                {
                    InputText = _wipeInputForDictation
                        ? result.Value
                        : string.IsNullOrWhiteSpace(_inputTextBeforeRecording)
                            ? result.Value
                            : _inputTextBeforeRecording + " " + result.Value;
                }
                else if (!result.IsSuccess)
                    _logger.Error("Chat", result.ErrorMessage ?? "Speech recognition failed.");
            });
        }
        catch (Exception ex)
        {
            _logger.Error("Chat", $"Speech recognition failed: {ex}");
        }
        finally
        {
            await Dispatcher.UIThread.InvokeAsync(() => IsBusy = false);
        }
    }

    private async Task CancelRecordingAsync()
    {
        if (!IsRecording) return;

        _recordingDurationCts?.Cancel();
        _recordingDurationCts?.Dispose();
        _recordingDurationCts = null;

        await _speechService.CancelRecordingAsync(CancellationToken.None).ConfigureAwait(false);

        await Dispatcher.UIThread.InvokeAsync(() =>
        {
            IsRecording = false;
            _recordingDuration = TimeSpan.Zero;
            OnPropertyChanged(nameof(RecordingDurationText));
            InputText = _inputTextBeforeRecording;
        });
    }

    /// <summary>Called by the view when scroll position changes; updates <see cref="ShowScrollToBottomButton"/> and auto-scroll attachment.</summary>
    public void NotifyScrollPosition(double offsetY, double extentHeight, double viewportHeight)
    {
        var atBottom = extentHeight - viewportHeight - offsetY <= ScrollToBottomThreshold;
        if (!atBottom)
        {
            ShowScrollToBottomButton = true;
            _isAutoScrollAttached = false;
        }
        else
        {
            ShowScrollToBottomButton = false;
            _isAutoScrollAttached = true;
        }
    }

    private void OnScrollToBottom()
    {
        _isAutoScrollAttached = true;
        ShowScrollToBottomButton = false;
        RequestScrollToBottom?.Invoke(this, EventArgs.Empty);
    }

    private void OnMessagesCollectionChanged(object? sender, NotifyCollectionChangedEventArgs e)
    {
        NotifyShowWelcomeIntroChanged();
        if (e.Action == NotifyCollectionChangedAction.Add && _isAutoScrollAttached)
            RequestScrollToBottom?.Invoke(this, EventArgs.Empty);
        SubscribeToLastMessage();
    }

    private void SubscribeToLastMessage()
    {
        if (_lastMessageSubscribed != null)
        {
            _lastMessageSubscribed.PropertyChanged -= OnLastMessageContentChanged;
            _lastMessageSubscribed = null;
        }
        if (Messages.Count == 0) return;
        var last = Messages[Messages.Count - 1];
        _lastMessageSubscribed = last;
        last.PropertyChanged += OnLastMessageContentChanged;
    }

    private void OnLastMessageContentChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(ChatMessageViewModel.Content) && _isAutoScrollAttached)
            ScheduleDebouncedScrollToBottom();
    }

    private void ScheduleDebouncedScrollToBottom()
    {
        Dispatcher.UIThread.Post(() =>
        {
            if (!_isAutoScrollAttached) return;
            if (_scrollToBottomDebounceTimer == null)
            {
                _scrollToBottomDebounceTimer = new DispatcherTimer
                {
                    Interval = TimeSpan.FromMilliseconds(100)
                };
                _scrollToBottomDebounceTimer.Tick += OnScrollToBottomDebounceTick;
            }

            _scrollToBottomDebounceTimer.Stop();
            _scrollToBottomDebounceTimer.Start();
        }, DispatcherPriority.Normal);
    }

    private void OnScrollToBottomDebounceTick(object? sender, EventArgs e)
    {
        _scrollToBottomDebounceTimer?.Stop();
        if (_isAutoScrollAttached)
            RequestScrollToBottom?.Invoke(this, EventArgs.Empty);
    }

    private void ApplySuggestion(string? suggestion)
    {
        if (!string.IsNullOrEmpty(suggestion))
            InputText = suggestion;
    }

    private void StopGeneration()
    {
        _cts?.Cancel();
    }

    /// <summary>Adds an attachment (file or image path). Call from view after file picker or screenshot capture.</summary>
    public void AddPendingAttachment(string path, ChatAttachmentKind kind, string? displayName = null)
    {
        if (string.IsNullOrWhiteSpace(path) || !File.Exists(path))
            return;
        var item = new ChatAttachmentViewModel(path, kind, displayName, RemoveAttachmentCommand);
        PendingAttachments.Add(item);
    }

    /// <summary>Determines if a file path should be treated as an image for the vision model.</summary>
    public static bool IsImagePath(string path)
    {
        var ext = System.IO.Path.GetExtension(path);
        return !string.IsNullOrEmpty(ext) && ImageExtensions.Contains(ext);
    }

    /// <summary>Opens an overlay preview for the given image path. No-op if path is invalid or file missing.</summary>
    private void OpenImagePreview(string? path)
    {
        if (string.IsNullOrWhiteSpace(path) || !File.Exists(path))
            return;
        var overlay = new ImagePreviewOverlay { ImagePath = path };
        var options = new OverlayOptions
        {
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            ShowBackdrop = true,
            CloseOnOutsideClick = true,
            CloseOnEscape = true
        };
        var id = _overlayService.CreateOverlay(overlay, options, "ImagePreview");
        overlay.CloseRequested += () => _overlayService.CloseOverlay(id);
    }

    private void NewChat()
    {
        if (!_isHistoryReady || IsRecording) return;
        if (IsBusy)
            StopGeneration();
        EnterEphemeralConversation(persistIfLeavingMaterialized: true);
        PendingAttachments.Clear();
    }

    private void SelectConversationById(string id, bool persistBookends = true)
    {
        if (!_isHistoryReady || IsRecording) return;
        if (IsBusy)
            StopGeneration();
        if (id == _conversationId) return;
        if (persistBookends && !_isEphemeralConversation && _chatSessions.ContainsKey(_conversationId))
            PersistFireAndForget();
        if (_isEphemeralConversation)
        {
            _ephemeralMessages.Clear();
            _isEphemeralConversation = false;
        }

        _conversationId = id;
        _turnIndex = CountUserTurns(ActiveSession!.Messages);
        foreach (var r in ConversationRows)
            r.IsSelected = r.ConversationId == id;
        ResubscribeActiveMessages();
        OnPropertyChanged(nameof(Messages));
        OnPropertyChanged(nameof(SelectedAssistantMode));
        RequestScrollToBottom?.Invoke(this, EventArgs.Empty);
        if (persistBookends)
            PersistFireAndForget();
        NotifyShowWelcomeIntroChanged();
        RefreshMemoryPillUi();
    }

    /// <summary>Starts a new thread that only appears in the sidebar and storage after the first user message.</summary>
    private void EnterEphemeralConversation(bool persistIfLeavingMaterialized)
    {
        if (persistIfLeavingMaterialized && !_isEphemeralConversation && _chatSessions.ContainsKey(_conversationId))
            PersistFireAndForget();

        if (!string.IsNullOrEmpty(_conversationId))
        {
            _memoryStore.Evict(_conversationId);
        }

        _conversationId = Guid.NewGuid().ToString("N");
        _ephemeralMessages.Clear();
        _isEphemeralConversation = true;
        _turnIndex = 0;
        foreach (var r in ConversationRows)
            r.IsSelected = false;
        ResubscribeActiveMessages();
        OnPropertyChanged(nameof(Messages));
        OnPropertyChanged(nameof(SelectedAssistantMode));
        NotifyShowWelcomeIntroChanged();
        RequestScrollToBottom?.Invoke(this, EventArgs.Empty);
        RefreshMemoryPillUi();
    }

    private void MaterializeEphemeralConversation()
    {
        if (!_isEphemeralConversation) return;
        var id = _conversationId;
        var session = new ChatSession
        {
            Id = id,
            AssistantMode = SelectedAssistantMode,
            LastActivityUtc = DateTime.UtcNow
        };
        _chatSessions[id] = session;
        _isEphemeralConversation = false;
        var row = new ChatConversationRowViewModel(id, i => SelectConversationById(i))
        {
            Title = _localizationService.T("NewChat", "Chat"),
            IsSelected = true
        };
        foreach (var r in ConversationRows)
            r.IsSelected = false;
        ConversationRows.Insert(0, row);
        ResubscribeActiveMessages();
        OnPropertyChanged(nameof(Messages));
        OnPropertyChanged(nameof(SelectedAssistantMode));
        NotifyShowWelcomeIntroChanged();
        RefreshMemoryPillUi();
    }

    private async Task LoadHistoryAsync()
    {
        try
        {
            var result = await _chatHistoryService.LoadAsync().ConfigureAwait(false);
            await Dispatcher.UIThread.InvokeAsync(() =>
            {
                if (_disposed) return;
                if (!result.IsSuccess || result.Value == null)
                {
                    _logger.Error("Chat", result.ErrorMessage ?? "History load failed");
                    ClearSessionsAndRows();
                    EnterEphemeralConversation(persistIfLeavingMaterialized: false);
                }
                else
                    ApplyDocument(result.Value);

                _isHistoryReady = true;
                NotifyHistorySensitiveCommands();
                ResubscribeActiveMessages();
                NotifyShowWelcomeIntroChanged();
                PersistFireAndForget();
            });
        }
        catch (Exception ex)
        {
            _logger.Error("Chat", $"History load failed: {ex}");
            await Dispatcher.UIThread.InvokeAsync(() =>
            {
                if (_disposed) return;
                ClearSessionsAndRows();
                EnterEphemeralConversation(persistIfLeavingMaterialized: false);
                _isHistoryReady = true;
                NotifyHistorySensitiveCommands();
                ResubscribeActiveMessages();
                NotifyShowWelcomeIntroChanged();
                PersistFireAndForget();
            });
        }
    }

    private void OnChatHistoryClearServiceCleared(object? sender, EventArgs e)
    {
        Dispatcher.UIThread.Post(() =>
        {
            if (_disposed) return;
            if (IsBusy)
                StopGeneration();
            PendingAttachments.Clear();
            InputText = string.Empty;
            if (!_isHistoryReady)
                return;
            ApplyDocument(new ChatModuleHistoryDocument { Version = 1, Conversations = new() });
            PersistFireAndForget();
        }, DispatcherPriority.Normal);
    }

    private void ApplyDocument(ChatModuleHistoryDocument doc)
    {
        ClearSessionsAndRows();
        var ordered = doc.Conversations.OrderByDescending(c => c.LastActivityUtc).ToList();
        if (ordered.Count == 0)
        {
            EnterEphemeralConversation(persistIfLeavingMaterialized: false);
            return;
        }

        _isEphemeralConversation = false;

        foreach (var c in ordered)
        {
            var session = MapPersistedConversation(c);
            _chatSessions[session.Id] = session;
            var row = new ChatConversationRowViewModel(session.Id, id => SelectConversationById(id))
            {
                Title = FormatTitleForRow(session),
                IsSelected = false
            };
            ConversationRows.Add(row);
        }

        var active = ordered[0];
        _conversationId = active.Id;
        _turnIndex = CountUserTurns(_chatSessions[active.Id].Messages);
        foreach (var r in ConversationRows)
            r.IsSelected = r.ConversationId == _conversationId;
        OnPropertyChanged(nameof(Messages));
        OnPropertyChanged(nameof(SelectedAssistantMode));
        NotifyShowWelcomeIntroChanged();
        RequestScrollToBottom?.Invoke(this, EventArgs.Empty);
        RefreshMemoryPillUi();
    }

    private void ClearSessionsAndRows()
    {
        if (_messagesSubscriptionTarget != null)
        {
            _messagesSubscriptionTarget.CollectionChanged -= OnMessagesCollectionChanged;
            _messagesSubscriptionTarget = null;
        }

        if (_lastMessageSubscribed != null)
        {
            _lastMessageSubscribed.PropertyChanged -= OnLastMessageContentChanged;
            _lastMessageSubscribed = null;
        }

        _isEphemeralConversation = false;
        _ephemeralMessages.Clear();
        _chatSessions.Clear();
        ConversationRows.Clear();
    }

    private ChatSession MapPersistedConversation(ChatModulePersistedConversation c)
    {
        var id = string.IsNullOrEmpty(c.Id) ? Guid.NewGuid().ToString("N") : c.Id;
        var session = new ChatSession
        {
            Id = id,
            AssistantMode = ChatStreamingHelper.NormalizeAssistantMode(c.AssistantMode),
            LastActivityUtc = c.LastActivityUtc == default ? DateTime.UtcNow : c.LastActivityUtc,
            CustomTitle = string.IsNullOrWhiteSpace(c.CustomTitle) ? null : c.CustomTitle.Trim()
        };
        foreach (var m in c.Messages ?? Enumerable.Empty<ChatModulePersistedMessage>())
            session.Messages.Add(MapFromPersistedMessage(m));
        StripLegacyWelcomeAssistantMessages(session);

        // Hydrate memory snapshot from persisted JSON
        if (!string.IsNullOrWhiteSpace(c.MemorySnapshotJson))
        {
            try
            {
                var snapshot = System.Text.Json.JsonSerializer.Deserialize<ConversationMemorySnapshot>(c.MemorySnapshotJson);
                if (snapshot != null)
                    _memoryStore.Load(snapshot);
            }
            catch (Exception ex)
            {
                _logger.Warning("Chat", $"Failed to deserialize memory snapshot for {id}: {ex.Message}");
            }
        }

        return session;
    }

    /// <summary>Removes persisted assistant-only welcome rows (with suggestion chips) from older saves.</summary>
    private static void StripLegacyWelcomeAssistantMessages(ChatSession session)
    {
        while (session.Messages.Count > 0)
        {
            var first = session.Messages[0];
            if (first.IsUser) break;
            if (first.Suggestions is { Count: > 0 })
                session.Messages.RemoveAt(0);
            else
                break;
        }
    }

    private ChatMessageViewModel MapFromPersistedMessage(ChatModulePersistedMessage m)
    {
        List<ChatAttachmentViewModel>? attachments = null;
        if (m.Attachments is { Count: > 0 })
        {
            attachments = new List<ChatAttachmentViewModel>();
            foreach (var a in m.Attachments)
            {
                if (string.IsNullOrWhiteSpace(a.Path)) continue;
                attachments.Add(new ChatAttachmentViewModel(a.Path, a.Kind, a.DisplayName, NoOpAttachmentCommand));
            }
        }

        var vm = new ChatMessageViewModel
        {
            Content = m.Content ?? string.Empty,
            IsUser = m.IsUser,
            Timestamp = m.TimestampUtc.Kind == DateTimeKind.Utc ? m.TimestampUtc.ToLocalTime() : m.TimestampUtc,
            Suggestions = m.Suggestions,
            Sources = m.Sources,
            Attachments = attachments is { Count: > 0 } ? attachments : null
        };

        if (!m.IsUser)
            HydrateAssistantProcessState(vm, m);

        return vm;
    }

    private static void HydrateAssistantProcessState(ChatMessageViewModel vm, ChatModulePersistedMessage m)
    {
        vm.Thoughts = m.Thoughts;
        vm.ThoughtsCount = m.ThoughtsCount;
        if (!string.IsNullOrEmpty(m.ProcessHeaderText))
            vm.ProcessHeaderText = m.ProcessHeaderText!;
        if (!string.IsNullOrEmpty(m.ElapsedText))
            vm.ElapsedText = m.ElapsedText;
        vm.IsProcessThreadExpanded = m.ProcessThreadExpanded ?? false;

        if (m.ProcessSteps is not { Count: > 0 }) return;

        foreach (var step in m.ProcessSteps)
            vm.ProcessSteps.Add(MapStepFromPersisted(step));
    }

    private static ChatProcessStepViewModel MapStepFromPersisted(ChatModulePersistedProcessStep s)
    {
        var phase = Enum.TryParse<ChatProcessPhaseKind>(s.PhaseKind, ignoreCase: true, out var pk)
            ? pk
            : ChatProcessPhaseKind.Routing;

        var vm = new ChatProcessStepViewModel
        {
            Label = s.Label ?? string.Empty,
            Detail = s.Detail,
            PhaseKind = phase,
            IsComplete = true,
            IsActive = false,
            IsPending = false
        };

        if (s.ToolCalls is not { Count: > 0 }) return vm;

        foreach (var tc in s.ToolCalls)
        {
            vm.ToolCalls.Add(new ChatToolCallViewModel
            {
                Name = tc.Name ?? string.Empty,
                Arguments = tc.Arguments ?? string.Empty,
                Result = tc.Result ?? string.Empty,
                Summary = tc.Summary ?? string.Empty
            });
        }

        return vm;
    }

    private static ChatModulePersistedMessage MapToPersistedMessage(ChatMessageViewModel m)
    {
        List<ChatModulePersistedAttachment>? attachments = null;
        if (m.Attachments is { Count: > 0 })
        {
            attachments = m.Attachments.Select(a => new ChatModulePersistedAttachment
            {
                Path = a.Path,
                Kind = a.Kind,
                DisplayName = a.DisplayName
            }).ToList();
        }

        var msg = new ChatModulePersistedMessage
        {
            Content = m.Content,
            IsUser = m.IsUser,
            TimestampUtc = m.Timestamp.ToUniversalTime(),
            Suggestions = m.Suggestions,
            Sources = m.Sources,
            Attachments = attachments
        };

        if (!m.IsUser)
            AppendAssistantProcessPersistence(msg, m);

        return msg;
    }

    private static void AppendAssistantProcessPersistence(ChatModulePersistedMessage msg, ChatMessageViewModel m)
    {
        msg.Thoughts = m.Thoughts;
        msg.ThoughtsCount = m.ThoughtsCount;
        msg.ProcessHeaderText = m.ProcessHeaderText;
        msg.ElapsedText = m.ElapsedText;
        msg.ProcessThreadExpanded = m.IsProcessThreadExpanded;

        if (m.ProcessSteps.Count == 0) return;

        msg.ProcessSteps = m.ProcessSteps.Select(MapStepToPersisted).ToList();
    }

    private static ChatModulePersistedProcessStep MapStepToPersisted(ChatProcessStepViewModel s)
    {
        return new ChatModulePersistedProcessStep
        {
            Label = s.Label,
            Detail = s.Detail,
            PhaseKind = s.PhaseKind.ToString(),
            IsComplete = s.IsComplete,
            ToolCalls = s.ToolCalls.Count == 0
                ? null
                : s.ToolCalls.Select(tc => new ChatModulePersistedToolCallEntry
                {
                    Name = tc.Name,
                    Arguments = tc.Arguments,
                    Result = tc.Result,
                    Summary = tc.Summary
                }).ToList()
        };
    }

    private ChatModuleHistoryDocument BuildPersistDocument()
    {
        var list = _chatSessions.Values
            .OrderByDescending(s => s.LastActivityUtc)
            .Select(s =>
            {
                string? memoryJson = null;
                var snapshot = _memoryStore.Get(s.Id);
                if (snapshot != null)
                {
                    try
                    {
                        memoryJson = System.Text.Json.JsonSerializer.Serialize(snapshot);
                    }
                    catch (Exception ex)
                    {
                        _logger.Warning("Chat", $"Failed to serialize memory snapshot for {s.Id}: {ex.Message}");
                    }
                }

                return new ChatModulePersistedConversation
                {
                    Id = s.Id,
                    LastActivityUtc = s.LastActivityUtc,
                    AssistantMode = s.AssistantMode,
                    CustomTitle = s.CustomTitle,
                    Messages = s.Messages.Select(MapToPersistedMessage).ToList(),
                    MemorySnapshotJson = memoryJson
                };
            })
            .ToList();
        return new ChatModuleHistoryDocument { Version = 1, Conversations = list };
    }

    private void PersistFireAndForget()
    {
        if (!_isHistoryReady || _disposed) return;
        _ = PersistHistoryAsync();
    }

    private async Task PersistHistoryAsync()
    {
        try
        {
            var doc = BuildPersistDocument();
            await _chatHistoryService.SaveAsync(doc).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            _logger.Error("Chat", $"History save failed: {ex}");
        }
    }

    private void ResubscribeActiveMessages()
    {
        if (_messagesSubscriptionTarget != null)
            _messagesSubscriptionTarget.CollectionChanged -= OnMessagesCollectionChanged;
        _messagesSubscriptionTarget = Messages;
        _messagesSubscriptionTarget.CollectionChanged += OnMessagesCollectionChanged;
        SubscribeToLastMessage();
    }

    private void NotifyHistorySensitiveCommands()
    {
        ((AsyncRelayCommand)SendMessageCommand).NotifyCanExecuteChanged();
        ((RelayCommand)NewChatCommand).NotifyCanExecuteChanged();
        OnPropertyChanged(nameof(CanNavigateChatHistory));
        OnPropertyChanged(nameof(CanSwitchChatHistory));
        DeleteChatCommand.NotifyCanExecuteChanged();
        RenameChatCommand.NotifyCanExecuteChanged();
    }

    private string FormatTitleForRow(ChatSession session)
    {
        if (!string.IsNullOrWhiteSpace(session.CustomTitle))
        {
            var t = session.CustomTitle.Trim();
            if (t.Length > 48)
                t = t[..45] + "…";
            return t;
        }

        return DeriveConversationTitle(session.Messages);
    }

    private string GetEditableTitle(ChatSession session)
    {
        if (!string.IsNullOrWhiteSpace(session.CustomTitle))
            return session.CustomTitle.Trim();
        foreach (var m in session.Messages)
        {
            if (!m.IsUser || string.IsNullOrWhiteSpace(m.Content)) continue;
            return m.Content.Trim().Replace("\r", " ").Replace("\n", " ");
        }

        return _localizationService.T("NewChat", "Chat");
    }

    private bool CanModifyChat(string? id) =>
        CanSwitchChatHistory && !string.IsNullOrEmpty(id) && _chatSessions.ContainsKey(id!);

    private void BeginRenameChat(string? conversationId)
    {
        if (string.IsNullOrEmpty(conversationId) || !_chatSessions.TryGetValue(conversationId, out var session)) return;

        var overlay = new InputDialogOverlay
        {
            Title = _localizationService.T("RenameChat", "Chat"),
            Placeholder = _localizationService.T("RenameChatPlaceholder", "Chat"),
            InputValue = GetEditableTitle(session),
            ConfirmText = _localizationService.T("Save", "Common"),
            CancelText = _localizationService.T("Cancel", "Common")
        };
        var options = new OverlayOptions
        {
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            ShowBackdrop = true,
            CloseOnOutsideClick = true,
            CloseOnEscape = true
        };
        var overlayInstanceId = _overlayService.CreateOverlay(overlay, options, "RenameChat");
        overlay.OnResult = result =>
        {
            _overlayService.CloseOverlay(overlayInstanceId);
            if (result == null) return;
            ApplyCustomTitle(conversationId, string.IsNullOrWhiteSpace(result) ? null : result.Trim());
        };
    }

    private void ApplyCustomTitle(string conversationId, string? customTitle)
    {
        if (!_chatSessions.TryGetValue(conversationId, out var session)) return;
        session.CustomTitle = string.IsNullOrWhiteSpace(customTitle) ? null : customTitle;
        var row = FindRow(conversationId);
        if (row != null)
            row.Title = FormatTitleForRow(session);
        PersistFireAndForget();
    }

    private async Task DeleteChatAsync(string? conversationId)
    {
        if (string.IsNullOrEmpty(conversationId) || !_chatSessions.ContainsKey(conversationId)) return;
        var deleteLabel = _localizationService.T("Delete", "Notes");
        var choice = await _overlayService.CreateDialogAsync(
            _localizationService.T("DeleteChatTitle", "Chat"),
            _localizationService.T("DeleteChatMessage", "Chat"),
            deleteLabel,
            _localizationService.T("Cancel", "Common"));
        if (choice != deleteLabel) return;

        await Dispatcher.UIThread.InvokeAsync(() => RemoveConversationCore(conversationId));
    }

    private void RemoveConversationCore(string conversationId)
    {
        var wasActive = _conversationId == conversationId;
        _chatSessions.Remove(conversationId);
        var row = FindRow(conversationId);
        if (row != null)
            ConversationRows.Remove(row);
        _memoryStore.Evict(conversationId);

        if (!wasActive)
        {
            PersistFireAndForget();
            return;
        }

        if (ConversationRows.Count > 0)
            SelectConversationById(ConversationRows[0].ConversationId, persistBookends: false);
        else
            EnterEphemeralConversation(persistIfLeavingMaterialized: false);
        PersistFireAndForget();
    }

    private string DeriveConversationTitle(IReadOnlyList<ChatMessageViewModel> messages)
    {
        foreach (var m in messages)
        {
            if (!m.IsUser || string.IsNullOrWhiteSpace(m.Content)) continue;
            var t = m.Content.Trim().Replace("\r", " ").Replace("\n", " ");
            if (t.Length > 48)
                t = t[..45] + "…";
            return t;
        }

        return _localizationService.T("NewChat", "Chat");
    }

    private static int CountUserTurns(ObservableCollection<ChatMessageViewModel> messages)
    {
        var n = 0;
        foreach (var m in messages)
        {
            if (m.IsUser && !string.IsNullOrWhiteSpace(m.Content))
                n++;
        }

        return n;
    }

    private ChatConversationRowViewModel? FindRow(string id)
    {
        foreach (var r in ConversationRows)
        {
            if (r.ConversationId == id)
                return r;
        }

        return null;
    }

    private void MoveActiveRowToTop()
    {
        var row = FindRow(_conversationId);
        if (row == null) return;
        var idx = ConversationRows.IndexOf(row);
        if (idx > 0)
            ConversationRows.Move(idx, 0);
    }

    private void RefreshActiveRowTitle()
    {
        var session = ActiveSession;
        var row = FindRow(_conversationId);
        if (session == null || row == null) return;
        if (!string.IsNullOrWhiteSpace(session.CustomTitle)) return;
        row.Title = DeriveConversationTitle(session.Messages);
    }

    private void TouchActiveConversationAfterUserMessage()
    {
        var session = ActiveSession;
        if (session == null) return;
        session.LastActivityUtc = DateTime.UtcNow;
        MoveActiveRowToTop();
        RefreshActiveRowTitle();
    }

    private async Task SendMessageAsync()
    {
        if (!_isHistoryReady || string.IsNullOrWhiteSpace(InputText) || IsBusy) return;

        MaterializeEphemeralConversation();

        var userMessage = InputText;
        InputText = string.Empty;

        var imagePaths = new List<string>();
        var pendingList = PendingAttachments.ToList();
        foreach (var a in pendingList)
        {
            if (a.Kind == ChatAttachmentKind.Image)
                imagePaths.Add(a.Path);
        }

        var messageAttachments = pendingList
            .Select(a => new ChatAttachmentViewModel(a.Path, a.Kind, a.DisplayName, NoOpAttachmentCommand))
            .ToList();
        PendingAttachments.Clear();

        Messages.Add(new ChatMessageViewModel
        {
            Content = userMessage,
            IsUser = true,
            Attachments = messageAttachments.Count > 0 ? messageAttachments : null
        });
        TouchActiveConversationAfterUserMessage();

        IsBusy = true;

        var aiMessage = new ChatMessageViewModel
        {
            Content = string.Empty,
            IsUser = false,
            IsStreaming = true
        };
        Messages.Add(aiMessage);

        _ = _typingPrefetch.RecordSendPauseAsync();

        await RunAssistantStreamingTurnCoreAsync(aiMessage, userMessage, imagePaths).ConfigureAwait(false);
    }

    private async Task RegenerateAssistantMessageAsync(ChatMessageViewModel? assistantMessage)
    {
        if (assistantMessage == null || assistantMessage.IsUser || IsBusy || IsRecording) return;
        var userMessage = FindPreviousUserMessage(assistantMessage);
        if (userMessage == null || string.IsNullOrWhiteSpace(userMessage.Content)) return;

        var imagePaths = new List<string>();
        if (userMessage.Attachments != null)
        {
            foreach (var a in userMessage.Attachments)
            {
                if (a.Kind == ChatAttachmentKind.Image)
                    imagePaths.Add(a.Path);
            }
        }

        var idx = Messages.IndexOf(assistantMessage);
        if (idx < 0) return;

        Messages.RemoveAt(idx);
        var newAi = new ChatMessageViewModel
        {
            Content = string.Empty,
            IsUser = false,
            IsStreaming = true
        };
        Messages.Insert(idx, newAi);

        IsBusy = true;
        await RunAssistantStreamingTurnCoreAsync(newAi, userMessage.Content, imagePaths).ConfigureAwait(false);
    }

    private async Task CopyAssistantMessageAsync(ChatMessageViewModel? message)
    {
        if (message == null || message.IsUser || string.IsNullOrWhiteSpace(message.Content)) return;
        try
        {
            var text = message.Content;
            await Dispatcher.UIThread.InvokeAsync(async () =>
            {
                if (Application.Current?.ApplicationLifetime is IClassicDesktopStyleApplicationLifetime { MainWindow: { Clipboard: { } clipboard } })
                    await clipboard.SetTextAsync(text).ConfigureAwait(true);
            }).ConfigureAwait(true);
        }
        catch (Exception ex)
        {
            _logger.Error("Chat", $"Copy to clipboard failed: {ex}");
        }
    }

    private bool CanRegenerateAssistantMessage(ChatMessageViewModel? m) =>
        m != null
        && !m.IsUser
        && !m.IsStreaming
        && CanUseChatActions
        && FindPreviousUserMessage(m) != null;

    private ChatMessageViewModel? FindPreviousUserMessage(ChatMessageViewModel assistantMessage)
    {
        var idx = Messages.IndexOf(assistantMessage);
        if (idx <= 0) return null;
        for (var i = idx - 1; i >= 0; i--)
        {
            if (Messages[i].IsUser)
                return Messages[i];
        }
        return null;
    }

    /// <summary>Runs orchestration and streaming for an assistant bubble that is already in <see cref="Messages"/>.</summary>
    private async Task RunAssistantStreamingTurnCoreAsync(ChatMessageViewModel aiMessage, string userMessage, IReadOnlyList<string> imagePaths = null!)
    {
        _cts = new CancellationTokenSource();

        var streamingTurn = await Dispatcher.UIThread.InvokeAsync(() =>
            (
                ConversationId: _conversationId,
                Messages: Messages,
                AssistantMode: SelectedAssistantMode
            ));

        _turnIndex++;

        // Build raw turns for summarizer input (excludes current user turn to avoid duplication)
        var rawConversationHistory = ChatStreamingHelper.BuildConversationHistory(
            streamingTurn.Messages, aiMessage, m => m.IsUser, m => m.Content,
            excludeLastUserTurn: true);

        // Build memory-aware history: summary turn + K raw tail (falls back to raw when no summary yet)
        var conversationHistory = await _memoryInjector.BuildHistoryWithMemoryAsync(
            streamingTurn.ConversationId,
            rawConversationHistory,
            userMessage,
            _cts.Token).ConfigureAwait(false);

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

            var baseSystemPrompt = ChatStreamingHelper.GetSystemPromptForMode(streamingTurn.AssistantMode);

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
                conversationRoutingKey: streamingTurn.ConversationId,
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
            _logger.Error("Chat", $"SendMessage failed: {ex}");
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

            // Increment the memory turn counter and trigger summarization if due.
            var fullTranscriptForMemory = ChatStreamingHelper.BuildFullConversationHistory(
                streamingTurn.Messages,
                m => m.IsUser,
                m => m.Content);
            _memoryStore.IncrementTurn(streamingTurn.ConversationId);
            _ = TryRunPostTurnMemoryAsync(streamingTurn.ConversationId, fullTranscriptForMemory);

            Dispatcher.UIThread.Post(() =>
            {
                IsBusy = false;
                if (!_disposed && _chatSessions.TryGetValue(streamingTurn.ConversationId, out var finishedSession))
                    finishedSession.LastActivityUtc = DateTime.UtcNow;
                RefreshMemoryPillUi();
                PersistFireAndForget();
            });
        }
    }

    private void RefreshMemoryPillUi()
    {
        if (string.IsNullOrEmpty(_conversationId))
        {
            ShowMemoryPill = false;
            MemoryPillDisplayText = string.Empty;
            MemoryPillTooltipText = string.Empty;
            return;
        }

        var snap = _memoryStore.Get(_conversationId);
        if (snap == null)
        {
            ShowMemoryPill = false;
            MemoryPillDisplayText = string.Empty;
            MemoryPillTooltipText = string.Empty;
            return;
        }

        var hasSummary = snap.LatestSummary != null && !string.IsNullOrWhiteSpace(snap.LatestSummary.Summary);
        var hasFacts = snap.Facts.Count > 0;
        var tier3 = snap.HasLongTermMemory;

        if (!hasSummary && !hasFacts && !tier3)
        {
            ShowMemoryPill = false;
            MemoryPillDisplayText = string.Empty;
            MemoryPillTooltipText = string.Empty;
            return;
        }

        ShowMemoryPill = true;
        var baseLabel = _localizationService.T("MemoryPill", "Chat");
        MemoryPillDisplayText = hasFacts ? $"{baseLabel} · {snap.Facts.Count}" : baseLabel;

        MemoryPillTooltipText = BuildMemoryTooltipText(snap);
    }

    private string BuildMemoryTooltipText(ConversationMemorySnapshot snap)
    {
        var sb = new StringBuilder(512);
        sb.AppendLine(_localizationService.T("MemoryPillTooltipHint", "Chat"));
        sb.AppendLine();

        if (snap.LatestSummary != null && !string.IsNullOrWhiteSpace(snap.LatestSummary.Summary))
        {
            sb.AppendLine(_localizationService.T("MemoryPillSectionSummary", "Chat"));
            sb.AppendLine(snap.LatestSummary.Summary.Trim());
            sb.AppendLine();
            sb.AppendLine($"{_localizationService.T("MemoryPillActiveSkill", "Chat")}: {snap.LatestSummary.ActiveSkill}");
            if (snap.LatestSummary.ActiveEntities.Count > 0)
            {
                foreach (var kvp in snap.LatestSummary.ActiveEntities.OrderBy(x => x.Key))
                    sb.AppendLine($"{kvp.Key}={kvp.Value}");
            }
            if (snap.LatestSummary.KeyFacts.Count > 0)
            {
                sb.AppendLine(_localizationService.T("MemoryPillKeyFacts", "Chat"));
                foreach (var f in snap.LatestSummary.KeyFacts.Take(12))
                    sb.AppendLine($"• {f}");
            }
            sb.AppendLine();
        }

        if (snap.Facts.Count > 0)
        {
            sb.AppendLine(_localizationService.T("MemoryPillSectionWorking", "Chat"));
            foreach (var f in snap.Facts.OrderByDescending(x => x.TurnNumber))
                sb.AppendLine($"{f.Key}={f.Value}  ({f.Source})");
            sb.AppendLine();
        }

        sb.AppendLine($"{_localizationService.T("MemoryPillTurnCount", "Chat")}: {snap.TurnCount}");
        if (snap.LastSummarizedTurn > 0)
            sb.AppendLine($"{_localizationService.T("MemoryPillLastSummarized", "Chat")}: {snap.LastSummarizedTurn}");
        if (snap.HasLongTermMemory)
            sb.AppendLine(_localizationService.T("MemoryPillTier3On", "Chat"));

        var s = sb.ToString().TrimEnd();
        const int maxLen = 6000;
        return s.Length <= maxLen ? s : s[..maxLen] + "…";
    }

    /// <summary>
    /// Post-turn memory maintenance: triggers Tier-2 summarization when due and Tier-3
    /// embedding when the conversation is long enough. Runs fire-and-forget.
    /// </summary>
    private async Task TryRunPostTurnMemoryAsync(
        string conversationId,
        IReadOnlyList<ConversationTurn> fullTranscriptOldestFirst)
    {
        try
        {
            var snapshot = _memoryStore.Get(conversationId);
            if (snapshot == null)
                return;

            var turnsSinceLastSummary = snapshot.TurnCount - snapshot.LastSummarizedTurn;
            if (turnsSinceLastSummary < SummarizationInterval)
            {
                _logger.Debug("Memory",
                    $"PostTurn: skip summarize conv={conversationId} (turnsSinceLast={turnsSinceLastSummary} < interval {SummarizationInterval})");
                return;
            }

            _logger.Info("Memory",
                $"PostTurn: summarizing conv={conversationId} turnCount={snapshot.TurnCount} lastSummarized={snapshot.LastSummarizedTurn}");

            // LastSummarizedTurn counts completed user↔assistant exchanges already in the rolling summary.
            // Transcript is [U1,A1,U2,A2,...]; each "turn" is two ConversationTurn entries.
            var pairStartIndex = 2 * snapshot.LastSummarizedTurn;
            if (pairStartIndex >= fullTranscriptOldestFirst.Count)
                return;

            var newTurns = fullTranscriptOldestFirst.Skip(pairStartIndex).ToList();
            if (newTurns.Count == 0)
                return;

            var summaryResult = await _memorySummarizer.SummarizeAsync(snapshot, newTurns)
                .ConfigureAwait(false);

            if (!summaryResult.IsSuccess || summaryResult.Value == null)
            {
                _logger.Warning("Memory",
                    $"PostTurn: summarization failed conv={conversationId}: {summaryResult.ErrorMessage}");
                return;
            }

            _memoryStore.SetSummary(conversationId, summaryResult.Value);
            _logger.Info("Memory", $"PostTurn: summary stored conv={conversationId}");

            // Persist the updated memory immediately after summarization
            PersistFireAndForget();
        }
        catch (Exception ex)
        {
            _logger.Warning("Memory", $"PostTurn: maintenance failed conv={conversationId}: {ex.Message}");
        }
        finally
        {
            try
            {
                Dispatcher.UIThread.Post(RefreshMemoryPillUi);
            }
            catch
            {
                // ignore UI teardown
            }
        }
    }

    private static void UpdateProcessHeader(ChatMessageViewModel message, ChatProcessThreadTracker tracker)
    {
        var e = tracker.Elapsed;
        message.ElapsedText = $"{(int)e.TotalMinutes:D2}:{e.Seconds:D2}";
        message.ProcessHeaderText = tracker.ActiveStepLabel ?? "Thinking…";
    }

    private static void FinalizeProcessHeader(ChatMessageViewModel message, ChatProcessThreadTracker? tracker)
    {
        if (tracker == null) return;
        var e = tracker.Elapsed;
        message.ElapsedText = $"{(int)e.TotalMinutes:D2}:{e.Seconds:D2}";
        var steps = message.ThoughtsCount;
        message.ProcessHeaderText = steps > 0
            ? $"Thought process ({steps} steps)"
            : "Thought process";
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed) return;
        _chatHistoryClearService.Cleared -= OnChatHistoryClearServiceCleared;
        _disposed = true;
        if (_messagesSubscriptionTarget != null)
            _messagesSubscriptionTarget.CollectionChanged -= OnMessagesCollectionChanged;
        if (_lastMessageSubscribed != null)
            _lastMessageSubscribed.PropertyChanged -= OnLastMessageContentChanged;
        _scrollToBottomDebounceTimer?.Stop();
        _scrollToBottomDebounceTimer = null;
        _cts?.Cancel();
        _cts?.Dispose();
        _recordingDurationCts?.Cancel();
        _recordingDurationCts?.Dispose();
        try
        {
            if (_isHistoryReady && _chatSessions.Count > 0)
            {
                var doc = BuildPersistDocument();
                // Dispose runs on the UI thread (via NavigationService.CurrentViewModel setter).
                // Persist on the threadpool so navigation stays smooth; log failures from the continuation.
                var historyService = _chatHistoryService;
                var logger = _logger;
                _ = Task.Run(async () =>
                {
                    try
                    {
                        await historyService.SaveAsync(doc).ConfigureAwait(false);
                    }
                    catch (Exception ex)
                    {
                        logger.Error("Chat", $"History flush on dispose failed: {ex}");
                    }
                });
            }
        }
        catch (Exception ex)
        {
            _logger.Error("Chat", $"History flush on dispose failed: {ex}");
        }
    }

    private sealed class ChatSession
    {
        public required string Id { get; init; }

        public ObservableCollection<ChatMessageViewModel> Messages { get; } = new();

        public string AssistantMode { get; set; } = "Normal";

        public DateTime LastActivityUtc { get; set; }

        public string? CustomTitle { get; set; }
    }
}
