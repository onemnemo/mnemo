using System.Collections.ObjectModel;
using Mnemo.UI.ViewModels;

namespace Mnemo.UI.Ai.Overlay;

/// <summary>
/// A single question/answer exchange shown inside the compact Ask overlay. Reuses the
/// shared <see cref="ChatProcessStepViewModel"/> thread so the status pill and tool-call
/// expanders render identically to the full chat module.
/// </summary>
public sealed class AskTurnViewModel : ViewModelBase
{
    private string _question = string.Empty;
    public string Question
    {
        get => _question;
        set => SetProperty(ref _question, value);
    }

    private string _content = string.Empty;
    public string Content
    {
        get => _content;
        set
        {
            if (SetProperty(ref _content, value))
                OnPropertyChanged(nameof(HasContent));
        }
    }

    public bool HasContent => !string.IsNullOrEmpty(_content);

    private bool _isStreaming;
    public bool IsStreaming
    {
        get => _isStreaming;
        set => SetProperty(ref _isStreaming, value);
    }

    private bool _isProcessExpanded;
    public bool IsProcessExpanded
    {
        get => _isProcessExpanded;
        set => SetProperty(ref _isProcessExpanded, value);
    }

    private string _processHeaderText = string.Empty;
    public string ProcessHeaderText
    {
        get => _processHeaderText;
        set => SetProperty(ref _processHeaderText, value);
    }

    private string _elapsedText = string.Empty;
    public string ElapsedText
    {
        get => _elapsedText;
        set => SetProperty(ref _elapsedText, value);
    }

    private bool _hasProcess;
    /// <summary>True once at least one process step exists, so the pill renders.</summary>
    public bool HasProcess
    {
        get => _hasProcess;
        set => SetProperty(ref _hasProcess, value);
    }

    public ObservableCollection<ChatProcessStepViewModel> ProcessSteps { get; } = new();
}
