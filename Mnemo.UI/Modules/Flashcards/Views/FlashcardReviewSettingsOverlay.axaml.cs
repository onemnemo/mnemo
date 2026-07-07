using System;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Threading;
using Microsoft.Extensions.DependencyInjection;
using Mnemo.Core.Services;
using Mnemo.UI.Modules.Flashcards.ViewModels;

namespace Mnemo.UI.Modules.Flashcards.Views;

/// <summary>
/// "Review settings" preset dialog: a sidebar of shared scheduling presets and a details
/// pane for the selected preset's daily limits, scheduling and session behaviour. All logic lives
/// in <see cref="FlashcardReviewSettingsViewModel"/>; this code-behind only wires view-only
/// concerns (row selection gestures, inline rename focus) and the static launcher.
/// </summary>
public partial class FlashcardReviewSettingsOverlay : UserControl
{
    /// <summary>Raised when the dialog should close (Cancel, Save-completed, or close button).</summary>
    public Action? CloseRequested { get; set; }

    public FlashcardReviewSettingsOverlay()
    {
        InitializeComponent();
    }

    protected override void OnDataContextChanged(EventArgs e)
    {
        base.OnDataContextChanged(e);
        if (DataContext is FlashcardReviewSettingsViewModel vm)
            vm.RequestClose += OnViewModelRequestClose;
    }

    protected override void OnDetachedFromVisualTree(VisualTreeAttachmentEventArgs e)
    {
        if (DataContext is FlashcardReviewSettingsViewModel vm)
            vm.RequestClose -= OnViewModelRequestClose;
        base.OnDetachedFromVisualTree(e);
    }

    protected override void OnKeyDown(KeyEventArgs e)
    {
        if (e.Key == Key.Escape)
        {
            e.Handled = true;
            (DataContext as FlashcardReviewSettingsViewModel)?.Cancel();
            return;
        }
        base.OnKeyDown(e);
    }

    private void OnViewModelRequestClose(object? sender, EventArgs e) => CloseRequested?.Invoke();

    private void OnCloseClick(object? sender, RoutedEventArgs e) =>
        (DataContext as FlashcardReviewSettingsViewModel)?.Cancel();

    private void OnPresetRowPointerPressed(object? sender, PointerPressedEventArgs e)
    {
        if (DataContext is not FlashcardReviewSettingsViewModel vm) return;
        if (sender is not Control { DataContext: FlashcardPresetItemViewModel item }) return;
        if (item.IsRenaming) return;
        vm.SelectPresetCommand.Execute(item);
    }

    private void OnPresetRowDoubleTapped(object? sender, TappedEventArgs e)
    {
        if (DataContext is not FlashcardReviewSettingsViewModel vm) return;
        if (sender is not Control { DataContext: FlashcardPresetItemViewModel item }) return;
        vm.BeginRenameCommand.Execute(item);
    }

    private void OnNewPresetPointerPressed(object? sender, PointerPressedEventArgs e)
    {
        (DataContext as FlashcardReviewSettingsViewModel)?.CreatePresetCommand.Execute(null);
    }

    private void OnRenameBoxAttached(object? sender, VisualTreeAttachmentEventArgs e)
    {
        if (sender is not TextBox box) return;
        Dispatcher.UIThread.Post(() =>
        {
            box.Focus();
            box.SelectAll();
        }, DispatcherPriority.Loaded);
    }

    private void OnRenameBoxKeyDown(object? sender, KeyEventArgs e)
    {
        if (DataContext is not FlashcardReviewSettingsViewModel vm) return;
        if (sender is not TextBox { DataContext: FlashcardPresetItemViewModel item }) return;

        if (e.Key == Key.Enter)
        {
            e.Handled = true;
            vm.CommitRenameCommand.Execute(item);
        }
        else if (e.Key == Key.Escape)
        {
            e.Handled = true;
            vm.CancelRenameCommand.Execute(item);
        }
    }

    private void OnRenameBoxLostFocus(object? sender, RoutedEventArgs e)
    {
        if (DataContext is not FlashcardReviewSettingsViewModel vm) return;
        if (sender is not TextBox { DataContext: FlashcardPresetItemViewModel item }) return;
        if (item.IsRenaming)
            vm.CommitRenameCommand.Execute(item);
    }

    /// <summary>
    /// Resolves the VM from DI, loads it for the given deck (or no deck context), and presents it as
    /// a centered, backdropped overlay. Future entry point from deck-level UI.
    /// </summary>
    public static void Open(IOverlayService overlayService, IServiceProvider services, string? deckId, string? deckName)
    {
        if (overlayService == null) throw new ArgumentNullException(nameof(overlayService));
        if (services == null) throw new ArgumentNullException(nameof(services));

        var vm = services.GetRequiredService<FlashcardReviewSettingsViewModel>();
        var view = new FlashcardReviewSettingsOverlay { DataContext = vm };

        var overlayId = overlayService.CreateOverlay(view, new OverlayOptions
        {
            HorizontalAlignment = Avalonia.Layout.HorizontalAlignment.Center,
            VerticalAlignment = Avalonia.Layout.VerticalAlignment.Center,
            ShowBackdrop = true,
            CloseOnOutsideClick = true
        }, "FlashcardReviewSettings");
        view.CloseRequested = () => overlayService.CloseOverlay(overlayId);

        _ = vm.InitializeAsync(deckId, deckName);
    }
}
