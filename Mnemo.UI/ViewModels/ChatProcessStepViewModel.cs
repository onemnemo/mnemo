using System.Collections.ObjectModel;

namespace Mnemo.UI.ViewModels;

public enum ChatProcessPhaseKind
{
    Routing,
    Model,
    Generating,
    Tool,
    Continuing
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
    /// <summary>Short collapsed-row summary, e.g. "2 documents read".</summary>
    public string Summary
    {
        get => _summary;
        set => SetProperty(ref _summary, value);
    }
}

/// <summary>One line in the assistant message process thread (routing → model → tools → …).</summary>
public class ChatProcessStepViewModel : ViewModelBase
{
    private string _label = string.Empty;
    public string Label
    {
        get => _label;
        set => SetProperty(ref _label, value);
    }

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
        set => SetProperty(ref _isComplete, value);
    }

    private bool _isActive;
    public bool IsActive
    {
        get => _isActive;
        set => SetProperty(ref _isActive, value);
    }

    private bool _isPending;
    public bool IsPending
    {
        get => _isPending;
        set => SetProperty(ref _isPending, value);
    }

    public ChatProcessPhaseKind PhaseKind { get; set; }

    public ObservableCollection<ChatToolCallViewModel> ToolCalls { get; } = new();

    public bool HasToolCalls => ToolCalls.Count > 0;

    public ChatProcessStepViewModel()
    {
        ToolCalls.CollectionChanged += (_, _) =>
        {
            OnPropertyChanged(nameof(HasToolCalls));
        };
    }
}
