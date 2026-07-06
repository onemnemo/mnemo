using System.Collections.ObjectModel;
using Avalonia.Media;
using CommunityToolkit.Mvvm.ComponentModel;
using Mnemo.UI.ViewModels;

namespace Mnemo.UI.Modules.Mindmap.ViewModels;

public partial class MindmapItemViewModel : ViewModelBase
{
    [ObservableProperty]
    private string _id = string.Empty;

    [ObservableProperty]
    private string _name = string.Empty;

    [ObservableProperty]
    private string _lastModified = string.Empty;

    [ObservableProperty]
    private int _nodeCount;

    [ObservableProperty]
    private int _edgeCount;

    /// <summary>Owning folder id, or null when the map lives at the library root.</summary>
    [ObservableProperty]
    private string? _folderId;

    /// <summary>Card meta line, e.g. "28 nodes · 2 days ago".</summary>
    [ObservableProperty]
    private string _metaLine = string.Empty;

    /// <summary>Jump-back-in context line, e.g. "Geology · 2h ago".</summary>
    [ObservableProperty]
    private string _contextLine = string.Empty;

    /// <summary>Layout family label from the map's algorithm, e.g. "Radial" / "Tree" / "Free".</summary>
    [ObservableProperty]
    private string _layoutLabel = string.Empty;

    /// <summary>Cards due across this map's linked flashcard decks.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasDue))]
    private int _dueCount;

    /// <summary>Localized "N due" badge text.</summary>
    [ObservableProperty]
    private string _dueLabel = string.Empty;

    public bool HasDue => DueCount > 0;

    public ObservableCollection<NodePreviewViewModel> NodePreviews { get; } = new();
    public ObservableCollection<EdgePreviewViewModel> EdgePreviews { get; } = new();

    /// <summary>Up to four branch colors summarizing the map, shown as dots on the card.</summary>
    public ObservableCollection<IBrush> AccentDots { get; } = new();

    public string NodeStats => $"{NodeCount} nodes";
    public string EdgeStats => $"{EdgeCount} edges";
}
