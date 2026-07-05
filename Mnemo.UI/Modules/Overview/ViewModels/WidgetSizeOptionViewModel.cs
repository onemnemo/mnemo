using CommunityToolkit.Mvvm.ComponentModel;
using Mnemo.Core.Models.Widgets;

namespace Mnemo.UI.Modules.Overview.ViewModels;

/// <summary>
/// One selectable size chip ("2×1") in a widget tile's edit chrome.
/// </summary>
public partial class WidgetSizeOptionViewModel : ObservableObject
{
    public WidgetSize Size { get; }

    /// <summary>Chip label using the multiplication sign, e.g. "2×1". Not localized (numeric).</summary>
    public string Label => $"{Size.Columns}×{Size.Rows}";

    [ObservableProperty]
    private bool _isSelected;

    public WidgetSizeOptionViewModel(WidgetSize size, bool isSelected)
    {
        Size = size;
        _isSelected = isSelected;
    }
}
