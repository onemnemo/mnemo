using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Collections.Specialized;
using System.Linq;
using Mnemo.UI.ViewModels;

namespace Mnemo.UI.Modules.Chat.ViewModels;

/// <summary>Reader feedback on an assistant answer (thumbs up / down), or none.</summary>
public enum MessageFeedback
{
    None = 0,
    Up = 1,
    Down = 2,
}

/// <summary>
/// Why an assistant turn produced no answer. Rendered as an inline notice row instead of
/// answer prose; notices are transient (never persisted, never fed back into model history).
/// </summary>
public enum ChatNoticeKind
{
    None = 0,

    /// <summary>The configured provider needs an API key and none is set: points the user at Settings.</summary>
    MissingApiKey = 1,

    /// <summary>No model is bound / the model can't be reached right now.</summary>
    ModelUnavailable = 2,

    /// <summary>The turn failed for any other reason; offers a retry.</summary>
    Error = 3,
}

public class ChatMessageViewModel : ViewModelBase
{
    public ChatMessageViewModel()
    {
        ProcessSteps.CollectionChanged += OnProcessStepsChanged;
    }

    private void OnProcessStepsChanged(object? sender, NotifyCollectionChangedEventArgs e)
    {
        OnPropertyChanged(nameof(HasProcessThread));
        OnPropertyChanged(nameof(HasProcessThreadOrThoughts));
        OnPropertyChanged(nameof(HasSubstantiveProcessThread));
    }

    private string _content = string.Empty;
    public string Content
    {
        get => _content;
        set
        {
            if (SetProperty(ref _content, value))
            {
                OnPropertyChanged(nameof(HasCopiableAssistantContent));
                OnPropertyChanged(nameof(IsActivelyThinking));
                OnPropertyChanged(nameof(HasFinishedThinking));
                OnPropertyChanged(nameof(IsAwaitingFirstToken));
                OnPropertyChanged(nameof(ShowAnswerBody));
            }
        }
    }

    private ChatNoticeKind _noticeKind = ChatNoticeKind.None;
    /// <summary>Failure state of this assistant turn; anything but None renders the inline notice row.</summary>
    public ChatNoticeKind NoticeKind
    {
        get => _noticeKind;
        set
        {
            if (SetProperty(ref _noticeKind, value))
            {
                OnPropertyChanged(nameof(IsErrorNotice));
                OnPropertyChanged(nameof(ShowOpenSettings));
                OnPropertyChanged(nameof(ShowAnswerBody));
                OnPropertyChanged(nameof(ShowActionBar));
                OnPropertyChanged(nameof(HasCopiableAssistantContent));
            }
        }
    }

    public bool IsErrorNotice => _noticeKind != ChatNoticeKind.None;

    /// <summary>True when the notice should offer a jump to Settings (no API key configured).</summary>
    public bool ShowOpenSettings => _noticeKind == ChatNoticeKind.MissingApiKey;

    /// <summary>True when <see cref="Content"/> should render as the normal markdown answer body.</summary>
    public bool ShowAnswerBody => _content.Length > 0 && _noticeKind == ChatNoticeKind.None;

    private bool _isLatestAssistantTurn;
    /// <summary>
    /// True only on the newest assistant message in the thread; its action bar stays visible
    /// while earlier turns reveal theirs on hover.
    /// </summary>
    public bool IsLatestAssistantTurn
    {
        get => _isLatestAssistantTurn;
        set => SetProperty(ref _isLatestAssistantTurn, value);
    }

    private bool _isUser;
    public bool IsUser
    {
        get => _isUser;
        set
        {
            if (SetProperty(ref _isUser, value))
            {
                OnPropertyChanged(nameof(HasCopiableAssistantContent));
                OnPropertyChanged(nameof(ShowActionBar));
            }
        }
    }

    private DateTime _timestamp = DateTime.Now;
    public DateTime Timestamp
    {
        get => _timestamp;
        set => SetProperty(ref _timestamp, value);
    }

    private string? _thoughts;
    public string? Thoughts
    {
        get => _thoughts;
        set
        {
            if (SetProperty(ref _thoughts, value))
            {
                OnPropertyChanged(nameof(IsThinking));
                OnPropertyChanged(nameof(HasProcessThreadOrThoughts));
                OnPropertyChanged(nameof(HasSubstantiveProcessThread));
                OnPropertyChanged(nameof(IsActivelyThinking));
                OnPropertyChanged(nameof(HasFinishedThinking));
            }
        }
    }

    private int _thoughtsCount;
    public int ThoughtsCount
    {
        get => _thoughtsCount;
        set
        {
            if (SetProperty(ref _thoughtsCount, value))
                OnPropertyChanged(nameof(HasSubstantiveProcessThread));
        }
    }

    private string? _elapsedText;
    /// <summary>Formatted elapsed time string (e.g. "4s") updated while streaming.</summary>
    public string? ElapsedText
    {
        get => _elapsedText;
        set
        {
            if (SetProperty(ref _elapsedText, value))
                OnPropertyChanged(nameof(ElapsedSuffixText));
        }
    }

    /// <summary>
    /// <see cref="ElapsedText"/> with a leading space, so the header renders as one naturally
    /// spaced sentence ("Thought for 4s") instead of two gapped blocks. Empty when no elapsed.
    /// </summary>
    public string ElapsedSuffixText => string.IsNullOrEmpty(_elapsedText) ? string.Empty : $" {_elapsedText}";

    private string _processHeaderText = "Thought process";
    /// <summary>Single header text: active step label while streaming, thought process title when done.</summary>
    public string ProcessHeaderText
    {
        get => _processHeaderText;
        set => SetProperty(ref _processHeaderText, value);
    }

    private bool _isProcessThreadExpanded;
    /// <summary>Controls whether the thought process panel body is expanded (user toggle; default collapsed).</summary>
    public bool IsProcessThreadExpanded
    {
        get => _isProcessThreadExpanded;
        set => SetProperty(ref _isProcessThreadExpanded, value);
    }

    private string? _processSummaryText;
    /// <summary>Collapsed-trace summary suffix once the turn is done, e.g. "used 2 tools". Null while streaming or when no tools ran.</summary>
    public string? ProcessSummaryText
    {
        get => _processSummaryText;
        set
        {
            if (SetProperty(ref _processSummaryText, value))
                OnPropertyChanged(nameof(HasProcessSummary));
        }
    }

    public bool HasProcessSummary => !string.IsNullOrEmpty(_processSummaryText);

    private List<string>? _sources;
    public List<string>? Sources
    {
        get => _sources;
        set => SetProperty(ref _sources, value);
    }

    private List<string>? _suggestions;
    public List<string>? Suggestions
    {
        get => _suggestions;
        set => SetProperty(ref _suggestions, value);
    }

    private List<ChatAttachmentViewModel>? _attachments;
    /// <summary>Attachments sent with this message (e.g. images). Shown in the bubble for user messages.</summary>
    public List<ChatAttachmentViewModel>? Attachments
    {
        get => _attachments;
        set
        {
            if (SetProperty(ref _attachments, value))
                OnPropertyChanged(nameof(HasAttachments));
        }
    }

    public bool HasAttachments => _attachments is { Count: > 0 };

    public bool IsThinking => !string.IsNullOrEmpty(Thoughts);

    /// <summary>
    /// True while the model's reasoning trace is the only thing being
    /// produced, distinct from the "generating response" phase, which starts
    /// the moment visible <see cref="Content"/> begins to arrive. Drives the
    /// live "Thinking" indicator so the two states never look merged.
    /// </summary>
    public bool IsActivelyThinking => IsThinking && IsStreaming && Content.Length == 0;

    /// <summary>True once the model has moved on from reasoning to producing (or has finished) its final reply.</summary>
    public bool HasFinishedThinking => IsThinking && !IsActivelyThinking;

    /// <summary>True from send until the first visible token arrives; drives the answer-area shimmer skeleton.</summary>
    public bool IsAwaitingFirstToken => IsStreaming && Content.Length == 0;

    private MessageFeedback _feedback = MessageFeedback.None;
    /// <summary>Reader's thumbs feedback on this assistant answer.</summary>
    public MessageFeedback Feedback
    {
        get => _feedback;
        set
        {
            if (SetProperty(ref _feedback, value))
            {
                OnPropertyChanged(nameof(IsThumbUp));
                OnPropertyChanged(nameof(IsThumbDown));
            }
        }
    }

    public bool IsThumbUp => _feedback == MessageFeedback.Up;
    public bool IsThumbDown => _feedback == MessageFeedback.Down;

    private bool _isEditing;
    /// <summary>True while this user message is being edited inline (transient, never persisted).</summary>
    public bool IsEditing
    {
        get => _isEditing;
        set => SetProperty(ref _isEditing, value);
    }

    private string _editText = string.Empty;
    /// <summary>Working buffer for the inline edit field; applied to <see cref="Content"/> on submit.</summary>
    public string EditText
    {
        get => _editText;
        set => SetProperty(ref _editText, value);
    }

    private string? _pipelineStatusText;
    /// <summary>Localized pipeline label while routing or loading the model (cleared when reply text appears).</summary>
    public string? PipelineStatusText
    {
        get => _pipelineStatusText;
        set
        {
            if (SetProperty(ref _pipelineStatusText, value))
                OnPropertyChanged(nameof(HasPipelineStatus));
        }
    }

    public bool HasPipelineStatus => !string.IsNullOrEmpty(_pipelineStatusText);

    /// <summary>Ordered steps (routing, model, tools, …) shown under the assistant title.</summary>
    public ObservableCollection<ChatProcessStepViewModel> ProcessSteps { get; } = new();

    public bool HasProcessThread => ProcessSteps.Count > 0;

    public bool HasProcessThreadOrThoughts => HasProcessThread || IsThinking;

    /// <summary>
    /// True when the process thread is worth showing (tool use, continuation after tools, or explicit thinking text), not routing / model prep / generation alone.
    /// </summary>
    public bool HasSubstantiveProcessThread =>
        IsThinking
        || ThoughtsCount > 0
        || ProcessSteps.Any(s =>
            s.PhaseKind == ChatProcessPhaseKind.Tool
            || s.PhaseKind == ChatProcessPhaseKind.Continuing
            || s.HasToolCalls);

    private bool _isStreaming;
    /// <summary>True while the assistant message is still being generated (enables live token display).</summary>
    public bool IsStreaming
    {
        get => _isStreaming;
        set
        {
            if (SetProperty(ref _isStreaming, value))
            {
                OnPropertyChanged(nameof(HasCopiableAssistantContent));
                OnPropertyChanged(nameof(IsActivelyThinking));
                OnPropertyChanged(nameof(HasFinishedThinking));
                OnPropertyChanged(nameof(IsAwaitingFirstToken));
                OnPropertyChanged(nameof(ShowActionBar));
            }
        }
    }

    /// <summary>True when the thumbs/copy/regenerate action bar applies to this message.</summary>
    public bool ShowActionBar => !IsUser && !IsStreaming && !IsErrorNotice;

    /// <summary>True when this assistant bubble has finished text suitable for copying to the clipboard.</summary>
    public bool HasCopiableAssistantContent =>
        !IsUser && !IsStreaming && !IsErrorNotice && !string.IsNullOrWhiteSpace(Content);
}