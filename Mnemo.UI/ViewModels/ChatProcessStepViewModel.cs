using System.Collections.ObjectModel;
using System.Linq;

namespace Mnemo.UI.ViewModels;

public enum ChatProcessPhaseKind
{
    Routing,
    Model,
    Generating,
    Tool,
    Continuing,
    /// <summary>Mid-turn assistant prose (text emitted before a tool call) shown as quiet quoted context.</summary>
    Narration
}

public class ChatToolCallViewModel : ViewModelBase
{
    private bool _isRunning;
    /// <summary>True while the tool is executing (spinner state).</summary>
    public bool IsRunning
    {
        get => _isRunning;
        set
        {
            if (SetProperty(ref _isRunning, value))
                OnPropertyChanged(nameof(IsSucceeded));
        }
    }

    private bool _isFailed;
    /// <summary>True when the tool was rejected or failed (error state).</summary>
    public bool IsFailed
    {
        get => _isFailed;
        set
        {
            if (SetProperty(ref _isFailed, value))
                OnPropertyChanged(nameof(IsSucceeded));
        }
    }

    /// <summary>True once the tool completed successfully (checkmark state).</summary>
    public bool IsSucceeded => !_isRunning && !_isFailed;

    private string _name = string.Empty;
    public string Name
    {
        get => _name;
        set => SetProperty(ref _name, value);
    }

    private string _arguments = string.Empty;
    public string Arguments
    {
        get => _arguments;
        set => SetProperty(ref _arguments, value);
    }

    private string _result = string.Empty;
    public string Result
    {
        get => _result;
        set => SetProperty(ref _result, value);
    }

    private string _summary = string.Empty;
    /// <summary>Quiet count suffix rendered after the step label, e.g. "5 found" / "4 sources". Empty hides it.</summary>
    public string Summary
    {
        get => _summary;
        set
        {
            if (SetProperty(ref _summary, value))
                OnPropertyChanged(nameof(HasSummary));
        }
    }

    public bool HasSummary => !string.IsNullOrEmpty(_summary);

    private bool _isExpanded;
    /// <summary>Whether the args/result details box for this call is open.</summary>
    public bool IsExpanded
    {
        get => _isExpanded;
        set => SetProperty(ref _isExpanded, value);
    }
}

/// <summary>One line in the assistant message process thread (routing → model → tools → …).</summary>
public class ChatProcessStepViewModel : ViewModelBase
{
    private string _runningLabel = string.Empty;
    /// <summary>Present-progressive label shown while the step is active (e.g. "Checking your settings…").</summary>
    public string RunningLabel
    {
        get => _runningLabel;
        set
        {
            if (SetProperty(ref _runningLabel, value))
                OnPropertyChanged(nameof(Label));
        }
    }

    private string? _doneLabel;
    /// <summary>Past-tense label shown once the step completes (e.g. "Checked your settings"). Falls back to <see cref="RunningLabel"/>.</summary>
    public string? DoneLabel
    {
        get => _doneLabel;
        set
        {
            if (SetProperty(ref _doneLabel, value))
                OnPropertyChanged(nameof(Label));
        }
    }

    /// <summary>The label to render: past tense once complete, present-progressive while active.</summary>
    public string Label => _isComplete && !string.IsNullOrEmpty(_doneLabel) ? _doneLabel! : _runningLabel;

    /// <summary>Convenience: set a step whose running and done labels are identical.</summary>
    public string SimpleLabel
    {
        set
        {
            RunningLabel = value;
            DoneLabel = value;
        }
    }

    private string? _narration;
    /// <summary>For <see cref="ChatProcessPhaseKind.Narration"/> steps: the quoted mid-turn prose shown as quiet context.</summary>
    public string? Narration
    {
        get => _narration;
        set => SetProperty(ref _narration, value);
    }

    public bool IsNarration => PhaseKind == ChatProcessPhaseKind.Narration;

    private string? _detail;
    /// <summary>Optional sub-label shown below the label in secondary color.</summary>
    public string? Detail
    {
        get => _detail;
        set
        {
            if (SetProperty(ref _detail, value))
                OnPropertyChanged(nameof(HasDetail));
        }
    }

    public bool HasDetail => !string.IsNullOrEmpty(_detail);

    private bool _isComplete;
    public bool IsComplete
    {
        get => _isComplete;
        set
        {
            if (SetProperty(ref _isComplete, value))
            {
                OnPropertyChanged(nameof(ShowDoneIcon));
                OnPropertyChanged(nameof(Label));
            }
        }
    }

    private bool _isActive;
    public bool IsActive
    {
        get => _isActive;
        set
        {
            if (SetProperty(ref _isActive, value))
                OnPropertyChanged(nameof(ShowActiveIcon));
        }
    }

    private bool _isPending;
    public bool IsPending
    {
        get => _isPending;
        set => SetProperty(ref _isPending, value);
    }

    private bool _isLast;
    /// <summary>True for the final step; suppresses its downward rail connector.</summary>
    public bool IsLast
    {
        get => _isLast;
        set => SetProperty(ref _isLast, value);
    }

    public ChatProcessPhaseKind PhaseKind { get; set; }

    public ObservableCollection<ChatToolCallViewModel> ToolCalls { get; } = new();

    public bool HasToolCalls => ToolCalls.Count > 0;

    public bool HasFailedToolCall => ToolCalls.Any(t => t.IsFailed);

    // The rail glyph shows exactly one of four states; failure wins over active/done.
    public bool ShowFailedIcon => HasFailedToolCall;
    public bool ShowActiveIcon => IsActive && !HasFailedToolCall;
    public bool ShowDoneIcon => IsComplete && !HasFailedToolCall;

    public ChatProcessStepViewModel()
    {
        ToolCalls.CollectionChanged += (_, e) =>
        {
            if (e.OldItems is not null)
                foreach (ChatToolCallViewModel tc in e.OldItems)
                    tc.PropertyChanged -= OnToolCallPropertyChanged;
            if (e.NewItems is not null)
                foreach (ChatToolCallViewModel tc in e.NewItems)
                    tc.PropertyChanged += OnToolCallPropertyChanged;

            OnPropertyChanged(nameof(HasToolCalls));
            RaiseIconStateChanged();
        };
    }

    private void OnToolCallPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(ChatToolCallViewModel.IsFailed))
            RaiseIconStateChanged();
    }

    private void RaiseIconStateChanged()
    {
        OnPropertyChanged(nameof(HasFailedToolCall));
        OnPropertyChanged(nameof(ShowFailedIcon));
        OnPropertyChanged(nameof(ShowActiveIcon));
        OnPropertyChanged(nameof(ShowDoneIcon));
    }
}
