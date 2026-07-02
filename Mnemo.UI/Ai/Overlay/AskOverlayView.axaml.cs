using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Markup.Xaml;
using Avalonia.Threading;

namespace Mnemo.UI.Ai.Overlay;

public partial class AskOverlayView : UserControl
{
    public AskOverlayView()
    {
        InitializeComponent();
        Loaded += OnLoaded;
    }

    private void InitializeComponent() => AvaloniaXamlLoader.Load(this);

    private void OnLoaded(object? sender, RoutedEventArgs e)
    {
        Loaded -= OnLoaded;
        Dispatcher.UIThread.Post(() => this.FindControl<TextBox>("InputBox")?.Focus());
    }

    /// <summary>Enter sends; Shift+Enter inserts a newline.</summary>
    private void OnInputKeyDown(object? sender, KeyEventArgs e)
    {
        if (e.Key != Key.Enter || e.KeyModifiers.HasFlag(KeyModifiers.Shift))
            return;

        if (DataContext is AskOverlayViewModel vm && vm.SendCommand.CanExecute(null))
            vm.SendCommand.Execute(null);

        e.Handled = true;
    }
}
