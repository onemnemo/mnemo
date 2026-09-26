using Avalonia.Markup.Xaml;
using Mnemo.UI.Modules.Updates.ViewModels;

namespace Mnemo.UI.Components.Overlays;

public partial class RebuildNoticeOverlay : Avalonia.Controls.UserControl
{
    public RebuildNoticeOverlay()
    {
        InitializeComponent();
    }

    public RebuildNoticeOverlay(RebuildNoticeViewModel viewModel) : this()
    {
        DataContext = viewModel;
    }

    private void InitializeComponent() => AvaloniaXamlLoader.Load(this);
}
