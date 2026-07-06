using System.Collections.ObjectModel;
using Avalonia.Media;
using CommunityToolkit.Mvvm.ComponentModel;
using Mnemo.UI.ViewModels;

namespace Mnemo.UI.Modules.Mindmap.ViewModels;

/// <summary>
/// A folder tile in the mindmap library grid. Aggregates its whole subtree for counts and
/// borrows the newest child map's graph for the stacked thumbnail.
/// </summary>
public partial class MindmapFolderItemViewModel : ViewModelBase
{
    [ObservableProperty]
    private string _id = string.Empty;

    [ObservableProperty]
    private string _name = string.Empty;

    [ObservableProperty]
    private string? _parentId;

    /// <summary>Maps in this folder's whole subtree.</summary>
    [ObservableProperty]
    private int _mapCount;

    /// <summary>Cards due across every linked deck in this folder's subtree.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasDue))]
    private int _dueCount;

    public bool HasDue => DueCount > 0;

    /// <summary>Card meta line, e.g. "5 maps · updated 2h ago".</summary>
    [ObservableProperty]
    private string _metaLine = string.Empty;

    /// <summary>Thumbnail borrowed from the newest child map (empty for an empty folder).</summary>
    public ObservableCollection<NodePreviewViewModel> NodePreviews { get; } = new();
    public ObservableCollection<EdgePreviewViewModel> EdgePreviews { get; } = new();

    public bool HasPreview => NodePreviews.Count > 0;
}
