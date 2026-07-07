using System;
using System.Collections.Specialized;
using System.Linq;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Media.Imaging;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Microsoft.Extensions.DependencyInjection;
using Mnemo.Core.Services;
using Mnemo.UI.Modules.Flashcards.ViewModels;

namespace Mnemo.UI.Modules.Flashcards.Views;

/// <summary>
/// Study session shell code-behind. All state lives in <see cref="FlashcardSessionViewModel"/>;
/// this wires only view-only glue: the session keybinds (1 to 4 grade, Space reveal/good, E edit, Ctrl/Cmd+Z
/// undo, Escape close), click-to-reveal on the card, click-to-zoom on an attachment figure, and launching
/// the card editor / review-settings overlays — refreshing the current card when the editor closes.
/// Keybinds are handled at view level (the same pattern the editor / review-settings overlays use), since
/// this is a full-page focus owner rather than a route the global keymap targets.
/// </summary>
public partial class FlashcardSessionView : UserControl
{
    private const string CardEditorOverlayName = "FlashcardCardEditor";

    private FlashcardSessionViewModel? _viewModel;
    private IOverlayService? _overlay;
    private bool _editorOverlayOpen;

    public FlashcardSessionView()
    {
        InitializeComponent();
        DataContextChanged += OnDataContextChanged;
        AttachedToVisualTree += OnAttached;
        Unloaded += OnUnloaded;
        AttachViewModel(DataContext as FlashcardSessionViewModel);
    }

    private IServiceProvider? Services => (Application.Current as App)?.Services;

    private void OnDataContextChanged(object? sender, EventArgs e) =>
        AttachViewModel(DataContext as FlashcardSessionViewModel);

    private void AttachViewModel(FlashcardSessionViewModel? next)
    {
        if (ReferenceEquals(_viewModel, next))
            return;
        if (_viewModel is not null)
            _viewModel.EditRequested -= OnEditRequested;
        _viewModel = next;
        if (_viewModel is not null)
            _viewModel.EditRequested += OnEditRequested;
        EnsureOverlaySubscription();
    }

    private void OnAttached(object? sender, VisualTreeAttachmentEventArgs e) =>
        Dispatcher.UIThread.Post(() => Focus(), DispatcherPriority.Loaded);

    private void EnsureOverlaySubscription()
    {
        if (_overlay is not null)
            return;
        _overlay = Services?.GetService<IOverlayService>();
        if (_overlay is not null)
            _overlay.Overlays.CollectionChanged += OnOverlaysChanged;
    }

    private void OnUnloaded(object? sender, RoutedEventArgs e)
    {
        if (_overlay is not null)
        {
            _overlay.Overlays.CollectionChanged -= OnOverlaysChanged;
            _overlay = null;
        }
    }

    // Refresh the current card once the editor overlay closes (edits reflect immediately).
    private void OnOverlaysChanged(object? sender, NotifyCollectionChangedEventArgs e)
    {
        if (_overlay is null || _viewModel is null)
            return;
        var editorOpen = _overlay.Overlays.Any(o => string.Equals(o.Name, CardEditorOverlayName, StringComparison.Ordinal));
        if (_editorOverlayOpen && !editorOpen)
            _ = _viewModel.RefreshCurrentCardAsync();
        _editorOverlayOpen = editorOpen;
    }

    // --- Keybinds ----------------------------------------------------------

    protected override void OnKeyDown(KeyEventArgs e)
    {
        if (_viewModel is null)
        {
            base.OnKeyDown(e);
            return;
        }

        var primary = OperatingSystem.IsMacOS() ? KeyModifiers.Meta : KeyModifiers.Control;

        // Ctrl/Cmd+Z — undo.
        if (e.KeyModifiers.HasFlag(primary) && e.Key == Key.Z)
        {
            if (_viewModel.UndoCommand.CanExecute(null))
                _viewModel.UndoCommand.Execute(null);
            e.Handled = true;
            return;
        }

        // Bare-key shortcuts only (don't hijack modifier combos or typing in a focused input).
        if (e.KeyModifiers != KeyModifiers.None)
        {
            base.OnKeyDown(e);
            return;
        }

        switch (e.Key)
        {
            case Key.Escape:
                _viewModel.CloseCommand.Execute(null);
                e.Handled = true;
                return;
            case Key.Space:
                _viewModel.SpaceCommand.Execute(null);
                e.Handled = true;
                return;
            case Key.E:
                if (_viewModel.EditCommand.CanExecute(null))
                    _viewModel.EditCommand.Execute(null);
                e.Handled = true;
                return;
            case Key.D1:
            case Key.NumPad1:
                Grade(_viewModel.GradeAgainCommand);
                e.Handled = true;
                return;
            case Key.D2:
            case Key.NumPad2:
                Grade(_viewModel.GradeHardCommand);
                e.Handled = true;
                return;
            case Key.D3:
            case Key.NumPad3:
                Grade(_viewModel.GradeGoodCommand);
                e.Handled = true;
                return;
            case Key.D4:
            case Key.NumPad4:
                Grade(_viewModel.GradeEasyCommand);
                e.Handled = true;
                return;
        }

        base.OnKeyDown(e);
    }

    private static void Grade(System.Windows.Input.ICommand command)
    {
        if (command.CanExecute(null))
            command.Execute(null);
    }

    // --- Reveal on card click ---------------------------------------------

    private void OnCardTapped(object? sender, TappedEventArgs e)
    {
        if (_viewModel is null)
            return;
        // Ignore taps that originate on an interactive control inside the card (edit/flag/undo actions).
        if (e.Source is Visual source && source.FindAncestorOfType<Button>(includeSelf: true) is not null)
            return;
        // Only the pre-reveal front acts as a "show answer" surface; after reveal the card scrolls.
        if (_viewModel.RevealCommand.CanExecute(null))
            _viewModel.RevealCommand.Execute(null);
    }

    // --- Attachment lightbox ----------------------------------------------

    private void OnFigureTapped(object? sender, TappedEventArgs e)
    {
        if (sender is not Control { DataContext: FlashcardAttachmentCarousel carousel } || Services is not { } services)
            return;
        // Don't let the figure tap also fall through to the card's "reveal on tap".
        e.Handled = true;
        var path = carousel.CurrentPath;
        if (string.IsNullOrWhiteSpace(path))
            return;
        var overlay = services.GetService<IOverlayService>();
        if (overlay is null)
            return;
        ShowLightbox(overlay, path);
    }

    /// <summary>Simple click-to-dismiss zoom of a card attachment via the overlay service.</summary>
    private static void ShowLightbox(IOverlayService overlay, string path)
    {
        Bitmap? bitmap;
        try
        {
            bitmap = new Bitmap(path);
        }
        catch
        {
            return;
        }

        var image = new Image
        {
            Source = bitmap,
            Stretch = Stretch.Uniform,
            MaxWidth = 1200,
            MaxHeight = 900
        };
        var host = new Border
        {
            Child = image,
            Padding = new Thickness(24),
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center
        };

        var id = overlay.CreateOverlay(host, new OverlayOptions
        {
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            ShowBackdrop = true,
            CloseOnOutsideClick = true,
            CloseOnEscape = true
        }, "FlashcardStudyLightbox");
        host.PointerPressed += (_, _) => overlay.CloseOverlay(id);
    }

    // --- Overlay launchers -------------------------------------------------

    private void OnEditRequested(string cardId)
    {
        if (Services is not { } services || string.IsNullOrWhiteSpace(cardId))
            return;
        var overlay = services.GetService<IOverlayService>();
        if (overlay is null)
            return;
        FlashcardCardEditorOverlay.OpenForEdit(overlay, services, cardId);
    }

    private void OnSessionSettingsClick(object? sender, RoutedEventArgs e)
    {
        if (_viewModel is null || Services is not { } services)
            return;
        var overlay = services.GetService<IOverlayService>();
        if (overlay is null)
            return;
        FlashcardReviewSettingsOverlay.Open(overlay, services, _viewModel.SessionDeckId, _viewModel.DeckName);
    }
}
