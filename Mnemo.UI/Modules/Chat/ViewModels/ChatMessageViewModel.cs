using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Collections.Specialized;
using System.Linq;
using Mnemo.UI.ViewModels;

namespace Mnemo.UI.Modules.Chat.ViewModels;

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
            }
        }
    }

    private bool _isUser;
    public bool IsUser
    {
        get => _isUser;
        set
        {
            if (SetProperty(ref _isUser, value))
                OnPropertyChanged(nameof(HasCopiableAssistantContent));
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
    /// <summary>Formatted elapsed time string (e.g. "00:04") updated while streaming.</summary>
    public string? ElapsedText
    {
        get => _elapsedText;
        set
        {
            if (SetProperty(ref _elapsedText, value))
                OnPropertyChanged(nameof(HasElapsedText));
        }
    }

    public bool HasElapsedText => !string.IsNullOrEmpty(_elapsedText);

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
    /// produced — distinct from the "generating response" phase, which starts
    /// the moment visible <see cref="Content"/> begins to arrive. Drives the
    /// live "Thinking" indicator so the two states never look merged.
    /// </summary>
    public bool IsActivelyThinking => IsThinking && IsStreaming && Content.Length == 0;

    /// <summary>True once the model has moved on from reasoning to producing (or has finished) its final reply.</summary>
    public bool HasFinishedThinking => IsThinking && !IsActivelyThinking;

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
    /// True when the process thread is worth showing (tool use, continuation after tools, or explicit thinking text) — not routing / model prep / generation alone.
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
            }
        }
    }

    /// <summary>True when this assistant bubble has finished text suitable for copying to the clipboard.</summary>
    public bool HasCopiableAssistantContent =>
        !IsUser && !IsStreaming && !string.IsNullOrWhiteSpace(Content);
}