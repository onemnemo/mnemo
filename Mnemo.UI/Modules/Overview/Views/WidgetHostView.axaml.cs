using Avalonia.Controls;

namespace Mnemo.UI.Modules.Overview.Views;

/// <summary>
/// One widget tile. Purely declarative. Drag input is tracked by <see cref="OverviewView"/>
/// (pointer capture must live on an element that survives board reordering), and all board
/// mutations happen in the ViewModels.
/// </summary>
public partial class WidgetHostView : UserControl
{
    /// <summary>Name of the drag-handle element inside this view, matched by <see cref="OverviewView"/>.</summary>
    internal const string DragHandleName = "DragHandle";

    public WidgetHostView()
    {
        InitializeComponent();
    }
}
