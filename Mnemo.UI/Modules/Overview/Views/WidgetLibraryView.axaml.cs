using Avalonia;
using Avalonia.Controls;
using Mnemo.UI.Modules.Overview.ViewModels;

namespace Mnemo.UI.Modules.Overview.Views;

public partial class WidgetLibraryView : UserControl
{
    public WidgetLibraryView()
    {
        InitializeComponent();
    }

    protected override void OnDetachedFromVisualTree(VisualTreeAttachmentEventArgs e)
    {
        base.OnDetachedFromVisualTree(e);

        // The overlay can close via the X button, Escape, or the board's Done/Cancel —
        // detaching is the one signal common to all paths, so the owner cleans up here.
        if (DataContext is WidgetLibraryViewModel viewModel)
            viewModel.NotifyClosed();
    }
}
