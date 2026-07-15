using System.Windows.Input;
using CommunityToolkit.Mvvm.Input;
using Mnemo.UI.ViewModels;

namespace Mnemo.UI.Modules.Chat.ViewModels;

/// <summary>One row in the chat module history sidebar.</summary>
public sealed class ChatConversationRowViewModel : ViewModelBase
{
    public ChatConversationRowViewModel(string conversationId, System.Action<string> onSelected)
    {
        ConversationId = conversationId;
        SelectCommand = new RelayCommand(() => onSelected(ConversationId));
    }

    public string ConversationId { get; }

    private string _title = string.Empty;
    public string Title
    {
        get => _title;
        set => SetProperty(ref _title, value);
    }

    private bool _isSelected;
    public bool IsSelected
    {
        get => _isSelected;
        set => SetProperty(ref _isSelected, value);
    }

    private bool _isRowHovered;
    public bool IsRowHovered
    {
        get => _isRowHovered;
        set => SetProperty(ref _isRowHovered, value);
    }

    /// <summary>Last activity of the underlying session; drives the day-section bucketing, not bound directly.</summary>
    public System.DateTime LastActivityUtc { get; set; }

    private string _sectionLabel = string.Empty;
    /// <summary>Localized day-group label ("Today", "Yesterday", …) this row belongs to.</summary>
    public string SectionLabel
    {
        get => _sectionLabel;
        set => SetProperty(ref _sectionLabel, value);
    }

    private bool _showSectionLabel;
    /// <summary>True when this row is the first of its day group and should render the section header above it.</summary>
    public bool ShowSectionLabel
    {
        get => _showSectionLabel;
        set => SetProperty(ref _showSectionLabel, value);
    }

    public ICommand SelectCommand { get; }
}
