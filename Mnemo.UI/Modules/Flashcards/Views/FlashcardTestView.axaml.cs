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
/// Test session shell code-behind. All state lives in <see cref="FlashcardTestViewModel"/>; this
/// wires only view-only glue: the typed-answer box (Enter reveals, Shift+Enter inserts a newline), the
/// session keybinds after reveal (1 to 3 grade, Enter = Got it, E edit, Ctrl/Cmd+Z undo, Escape close),
/// click-to-zoom on the correct-answer figure, and launching the card editor / review-settings overlays,
/// refreshing the current card when the editor closes. The pattern mirrors the Review shell.
/// </summary>
public partial class FlashcardTestView : UserControl
{
    private const string CardEditorOverlayName = "FlashcardCardEditor";

    private FlashcardTestViewModel? _viewModel;
    private IOverlayService? _overlay;
    private bool _editorOverlayOpen;

    public FlashcardTestView()
    {
        InitializeComponent();
        DataContextChanged += OnDataContextChanged;
        AttachedToVisualTree += OnAttached;
        Unloaded += OnUnloaded;
        AttachViewModel(DataContext as FlashcardTestViewModel);
    }

    private IServiceProvider? Services => (Application.Current as App)?.Services;

    private void OnDataContextChanged(object? sender, EventArgs e) =>
        AttachViewModel(DataContext as FlashcardTestViewModel);

    private void AttachViewModel(FlashcardTestViewModel? next)
    {
        if (ReferenceEquals(_viewModel, next))
            return;
        if (_viewModel is not null)
        {
            _viewModel.EditRequested -= OnEditRequested;
            _viewModel.CardPresented -= OnCardPresented;
        }
        _viewModel = next;
        if (_viewModel is not null)
        {
            _viewModel.EditRequested += OnEditRequested;
            _viewModel.CardPresented += OnCardPresented;
        }
        EnsureOverlaySubscription();
    }

    private void OnAttached(object? sender, VisualTreeAttachmentEventArgs e) =>
        Dispatcher.UIThread.Post(FocusAnswerInput, DispatcherPriority.Loaded);

    // Auto-focus the answer box each time a fresh (unrevealed) card is shown.
    private void OnCardPresented() =>
        Dispatcher.UIThread.Post(FocusAnswerInput, DispatcherPriority.Loaded);

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

    /// <summary>Focus the answer input when it exists (start of each card, before reveal).</summary>
    private void FocusAnswerInput()
    {
        if (this.FindControl<TextBox>("AnswerInput") is { IsVisible: true } box)
            box.Focus();
        else
            Focus();
    }

    // --- Typed-answer box keys --------------------------------------------

    // Enter reveals (Shift+Enter inserts a newline). Handled here so it fires while the box has focus.
    private void OnAnswerKeyDown(object? sender, KeyEventArgs e)
    {
        if (_viewModel is null || e.Key != Key.Enter)
            return;
        if (e.KeyModifiers.HasFlag(KeyModifiers.Shift))
            return; // let the TextBox insert a newline
        if (_viewModel.RevealCommand.CanExecute(null))
            _viewModel.RevealCommand.Execute(null);
        e.Handled = true;
    }

    // --- Session keybinds --------------------------------------------------

    protected override void OnKeyDown(KeyEventArgs e)
    {
        if (_viewModel is null)
        {
            base.OnKeyDown(e);
            return;
        }

        var primary = OperatingSystem.IsMacOS() ? KeyModifiers.Meta : KeyModifiers.Control;

        // Ctrl/Cmd+Z — undo (available regardless of focus).
        if (e.KeyModifiers.HasFlag(primary) && e.Key == Key.Z)
        {
            if (_viewModel.UndoCommand.CanExecute(null))
                _viewModel.UndoCommand.Execute(null);
            e.Handled = true;
            return;
        }

        if (e.KeyModifiers != KeyModifiers.None)
        {
            base.OnKeyDown(e);
            return;
        }

        // Escape always closes the session.
        if (e.Key == Key.Escape)
        {
            _viewModel.CloseCommand.Execute(null);
            e.Handled = true;
            return;
        }

        // Before reveal, the answer box owns typing (1/2/3/E/Enter must reach it). The box's own
        // KeyDown handles Enter → reveal; everything else is normal text entry, so don't hijack keys.
        if (!_viewModel.IsRevealed)
        {
            base.OnKeyDown(e);
            return;
        }

        // After reveal: bare-key grade shortcuts.
        switch (e.Key)
        {
            case Key.Enter:
                Grade(_viewModel.GradeGotItCommand);
                e.Handled = true;
                return;
            case Key.D1:
            case Key.NumPad1:
                Grade(_viewModel.GradeMissedCommand);
                e.Handled = true;
                return;
            case Key.D2:
            case Key.NumPad2:
                Grade(_viewModel.GradeCloseCommand);
                e.Handled = true;
                return;
            case Key.D3:
            case Key.NumPad3:
                Grade(_viewModel.GradeGotItCommand);
                e.Handled = true;
                return;
            case Key.E:
                if (_viewModel.EditCommand.CanExecute(null))
                    _viewModel.EditCommand.Execute(null);
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

    // --- Attachment lightbox ----------------------------------------------

    private void OnFigureTapped(object? sender, TappedEventArgs e)
    {
        if (sender is not Control { DataContext: FlashcardAttachmentCarousel carousel } || Services is not { } services)
            return;
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
        }, "FlashcardTestLightbox");
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
