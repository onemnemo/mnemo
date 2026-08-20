using System;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Input.Platform;
using Avalonia.Interactivity;
using Avalonia.Media.Imaging;
using Avalonia.Platform.Storage;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Microsoft.Extensions.DependencyInjection;
using Mnemo.Core.Services;
using Mnemo.UI.Modules.Flashcards.ViewModels;

namespace Mnemo.UI.Modules.Flashcards.Views;

/// <summary>
/// The single add/edit card dialog. All logic lives in <see cref="FlashcardCardEditorViewModel"/>;
/// this code-behind wires view-only concerns: per-side focus tracking (drives the quiet format bar and
/// accent border), format-bar caret manipulation, image file-pick/drop/paste, inline tag entry, and the
/// dialog keybinds (Primary+Enter = save, Primary+Shift+C = wrap-cloze on the focused side). Keybinds are
/// handled at view level: the app's global flashcard dispatch targets the navigated deck view, not an
/// overlay, so a focus-owning modal wires them locally (the review-settings dialog handles Escape the same way).
/// </summary>
public partial class FlashcardCardEditorOverlay : UserControl
{
    /// <summary>Raised when the dialog should close (Close, Escape, outside-click, or edit-mode save).</summary>
    public Action? CloseRequested { get; set; }

    public FlashcardCardEditorOverlay()
    {
        InitializeComponent();
        AddHandler(DragDrop.DropEvent, OnDrop);
        AddHandler(DragDrop.DragOverEvent, OnDragOver);
    }

    protected override void OnDataContextChanged(EventArgs e)
    {
        base.OnDataContextChanged(e);
        if (DataContext is FlashcardCardEditorViewModel vm)
        {
            vm.RequestClose += OnViewModelRequestClose;
            vm.RequestFocusFront += OnRequestFocusFront;
            vm.RequestFocusTagInput += OnRequestFocusTagInput;
            vm.ImageFilePicker = PickImageFileAsync;
        }
    }

    protected override void OnDetachedFromVisualTree(VisualTreeAttachmentEventArgs e)
    {
        if (DataContext is FlashcardCardEditorViewModel vm)
        {
            vm.RequestClose -= OnViewModelRequestClose;
            vm.RequestFocusFront -= OnRequestFocusFront;
            vm.RequestFocusTagInput -= OnRequestFocusTagInput;
            vm.ImageFilePicker = null;
        }
        base.OnDetachedFromVisualTree(e);
    }

    private void OnViewModelRequestClose(object? sender, EventArgs e) => CloseRequested?.Invoke();

    // --- Keybinds -----------------------------------------------------------------------------

    protected override void OnKeyDown(KeyEventArgs e)
    {
        if (DataContext is not FlashcardCardEditorViewModel vm)
        {
            base.OnKeyDown(e);
            return;
        }

        var primary = OperatingSystem.IsMacOS() ? KeyModifiers.Meta : KeyModifiers.Control;
        var hasPrimary = e.KeyModifiers.HasFlag(primary);

        if (e.Key == Key.Escape)
        {
            e.Handled = true;
            CloseRequested?.Invoke();
            return;
        }

        // Primary+Shift+C: wrap the focused side's selection as a cloze deletion (cloze type only).
        if (hasPrimary && e.KeyModifiers.HasFlag(KeyModifiers.Shift) && e.Key == Key.C)
        {
            if (vm.IsCloze && vm.FocusedSide is { } side)
            {
                ApplyCloze(side);
                e.Handled = true;
                return;
            }
        }

        // Primary+Enter: the primary action (save-and-new / save).
        if (hasPrimary && (e.Key == Key.Enter || e.Key == Key.Return))
        {
            if (vm.PrimaryCommand.CanExecute(null))
                vm.PrimaryCommand.Execute(null);
            e.Handled = true;
            return;
        }

        // Primary+V on a focused side: attach a clipboard image if present, else fall through to
        // the TextBox's own text paste.
        if (hasPrimary && !e.KeyModifiers.HasFlag(KeyModifiers.Shift) && e.Key == Key.V && vm.FocusedSide is { } pasteSide)
        {
            _ = TryPasteImageThenFallThroughAsync(pasteSide);
            // Do not mark handled synchronously; if no image lands, text paste still works.
        }

        base.OnKeyDown(e);
    }

    // --- Focus tracking -----------------------------------------------------------------------

    private void OnFrontGotFocus(object? sender, RoutedEventArgs e)
    {
        if (DataContext is FlashcardCardEditorViewModel vm)
            vm.FocusedSide = FlashcardEditorSide.Front;
    }

    private void OnBackGotFocus(object? sender, RoutedEventArgs e)
    {
        if (DataContext is FlashcardCardEditorViewModel vm)
            vm.FocusedSide = FlashcardEditorSide.Back;
    }

    private void OnRequestFocusFront(object? sender, EventArgs e)
    {
        var box = this.FindControl<TextBox>("FrontInput");
        Dispatcher.UIThread.Post(() => box?.Focus(), DispatcherPriority.Loaded);
    }

    // --- Format bar ---------------------------------------------------------------------------

    private void OnFrontBoldClick(object? sender, RoutedEventArgs e) => ApplyWrap(FlashcardEditorSide.Front, WrapKind.Bold);
    private void OnFrontItalicClick(object? sender, RoutedEventArgs e) => ApplyWrap(FlashcardEditorSide.Front, WrapKind.Italic);
    private void OnFrontClozeClick(object? sender, RoutedEventArgs e) => ApplyCloze(FlashcardEditorSide.Front);
    private async void OnFrontImageClick(object? sender, RoutedEventArgs e) => await AttachViaPickerAsync(FlashcardEditorSide.Front);

    private void OnBackBoldClick(object? sender, RoutedEventArgs e) => ApplyWrap(FlashcardEditorSide.Back, WrapKind.Bold);
    private void OnBackItalicClick(object? sender, RoutedEventArgs e) => ApplyWrap(FlashcardEditorSide.Back, WrapKind.Italic);
    private void OnBackClozeClick(object? sender, RoutedEventArgs e) => ApplyCloze(FlashcardEditorSide.Back);
    private async void OnBackImageClick(object? sender, RoutedEventArgs e) => await AttachViaPickerAsync(FlashcardEditorSide.Back);

    private enum WrapKind { Bold, Italic }

    private void ApplyWrap(FlashcardEditorSide side, WrapKind kind)
    {
        if (DataContext is not FlashcardCardEditorViewModel vm)
            return;
        var box = SideBox(side);
        if (box is null)
            return;

        var (start, end) = SelectionRange(box);
        var (newText, caret) = kind == WrapKind.Bold
            ? vm.WrapBold(side, start, end)
            : vm.WrapItalic(side, start, end);
        ApplyEditedText(vm, side, box, newText, caret);
    }

    private void ApplyCloze(FlashcardEditorSide side)
    {
        if (DataContext is not FlashcardCardEditorViewModel vm)
            return;
        var box = SideBox(side);
        if (box is null)
            return;

        var (start, end) = SelectionRange(box);
        var (newText, caret) = vm.WrapCloze(side, start, end);
        ApplyEditedText(vm, side, box, newText, caret);
    }

    private static void ApplyEditedText(FlashcardCardEditorViewModel vm, FlashcardEditorSide side, TextBox box, string newText, int caret)
    {
        vm.SetSideText(side, newText);
        Dispatcher.UIThread.Post(() =>
        {
            box.Focus();
            box.CaretIndex = Math.Clamp(caret, 0, newText.Length);
        }, DispatcherPriority.Input);
    }

    private TextBox? SideBox(FlashcardEditorSide side) =>
        this.FindControl<TextBox>(side == FlashcardEditorSide.Back ? "BackInput" : "FrontInput");

    private static (int Start, int End) SelectionRange(TextBox box)
    {
        var start = Math.Min(box.SelectionStart, box.SelectionEnd);
        var end = Math.Max(box.SelectionStart, box.SelectionEnd);
        if (start == end)
            start = end = box.CaretIndex;
        return (start, end);
    }

    // --- Image attach: picker / drop / paste --------------------------------------------------

    private async Task AttachViaPickerAsync(FlashcardEditorSide side)
    {
        if (DataContext is not FlashcardCardEditorViewModel vm)
            return;
        var path = await PickImageFileAsync().ConfigureAwait(true);
        if (path != null)
            await vm.AttachImageAsync(side, path).ConfigureAwait(true);
    }

    private async Task<string?> PickImageFileAsync()
    {
        var top = TopLevel.GetTopLevel(this);
        if (top is null)
            return null;

        var files = await top.StorageProvider.OpenFilePickerAsync(new FilePickerOpenOptions
        {
            AllowMultiple = false,
            FileTypeFilter = new[]
            {
                new FilePickerFileType("Images")
                {
                    Patterns = new[] { "*.png", "*.jpg", "*.jpeg", "*.gif", "*.webp" }
                }
            }
        }).ConfigureAwait(true);

        var file = files.FirstOrDefault();
        return file?.TryGetLocalPath();
    }

    private void OnDragOver(object? sender, DragEventArgs e)
    {
        e.DragEffects = e.DataTransfer.Contains(DataFormat.File) ? DragDropEffects.Copy : DragDropEffects.None;
    }

    private async void OnDrop(object? sender, DragEventArgs e)
    {
        if (DataContext is not FlashcardCardEditorViewModel vm)
            return;

        var side = SideForVisual(e.Source as Visual) ?? vm.FocusedSide;
        if (side is null)
            return;

        try
        {
            if (e.DataTransfer is not IAsyncDataTransfer transfer)
                return;

            var files = await transfer.TryGetFilesAsync().ConfigureAwait(true);
            if (files != null)
            {
                foreach (var item in files)
                {
                    var path = item.TryGetLocalPath();
                    if (await TryAttachImagePathAsync(vm, side.Value, path).ConfigureAwait(true))
                        e.Handled = true;
                }
                if (e.Handled)
                    return;
            }

            var bitmap = await transfer.TryGetBitmapAsync().ConfigureAwait(true);
            if (bitmap != null)
            {
                try
                {
                    if (await AttachBitmapAsync(vm, side.Value, bitmap).ConfigureAwait(true))
                        e.Handled = true;
                }
                finally
                {
                    bitmap.Dispose();
                }
            }
        }
        catch
        {
            // Best effort: a failed drop simply attaches nothing.
        }
    }

    private async Task TryPasteImageThenFallThroughAsync(FlashcardEditorSide side)
    {
        // Fire-and-forget from the key handler: if the clipboard holds an image it becomes an
        // attachment; if it holds text, this is a no-op and the TextBox's own paste already ran.
        await TryPasteClipboardImageAsync(side).ConfigureAwait(true);
    }

    /// <summary>Handles Ctrl/Cmd+V on a focused side: attaches a clipboard image (file or bitmap).</summary>
    private async Task<bool> TryPasteClipboardImageAsync(FlashcardEditorSide side)
    {
        if (DataContext is not FlashcardCardEditorViewModel vm)
            return false;
        var clipboard = TopLevel.GetTopLevel(this)?.Clipboard;
        if (clipboard is null)
            return false;

        try
        {
            var files = await clipboard.TryGetFilesAsync().ConfigureAwait(true);
            if (files != null)
            {
                foreach (var item in files)
                {
                    if (await TryAttachImagePathAsync(vm, side, item.TryGetLocalPath()).ConfigureAwait(true))
                        return true;
                }
            }

            // Raw bitmap on the clipboard (e.g. a screenshot).
            var bitmap = await clipboard.TryGetBitmapAsync().ConfigureAwait(true);
            if (bitmap != null)
            {
                try
                {
                    return await AttachBitmapAsync(vm, side, bitmap).ConfigureAwait(true);
                }
                finally
                {
                    bitmap.Dispose();
                }
            }
        }
        catch
        {
            // Best effort: unsupported clipboard content falls through to normal text paste.
        }

        return false;
    }

    private static async Task<bool> TryAttachImagePathAsync(FlashcardCardEditorViewModel vm, FlashcardEditorSide side, string? path)
    {
        if (string.IsNullOrWhiteSpace(path) || !File.Exists(path))
            return false;
        if (!FlashcardCardEditorViewModel.ImageExtensions.Contains(Path.GetExtension(path), StringComparer.OrdinalIgnoreCase))
            return false;
        return await vm.AttachImageAsync(side, path).ConfigureAwait(true);
    }

    /// <summary>Persists a clipboard/drop bitmap to a temp png, then attaches a stored copy of it.</summary>
    private static async Task<bool> AttachBitmapAsync(FlashcardCardEditorViewModel vm, FlashcardEditorSide side, Bitmap bitmap)
    {
        var temp = Path.Combine(Path.GetTempPath(), $"mnemo_paste_{Guid.NewGuid():N}.png");
        try
        {
            bitmap.Save(temp);
            return await vm.AttachImageAsync(side, temp).ConfigureAwait(true);
        }
        finally
        {
            try { File.Delete(temp); } catch (IOException) { }
        }
    }

    private FlashcardEditorSide? SideForVisual(Visual? source)
    {
        if (source is null)
            return null;
        var front = this.FindControl<TextBox>("FrontInput");
        var back = this.FindControl<TextBox>("BackInput");
        if (back != null && (ReferenceEquals(source, back) || back.IsVisualAncestorOf(source)))
            return FlashcardEditorSide.Back;
        if (front != null && (ReferenceEquals(source, front) || front.IsVisualAncestorOf(source)))
            return FlashcardEditorSide.Front;

        // Walk up looking for either field container.
        return WalkForSide(source);
    }

    private FlashcardEditorSide? WalkForSide(Visual source)
    {
        var back = this.FindControl<TextBox>("BackInput");
        var front = this.FindControl<TextBox>("FrontInput");
        var backField = back?.FindAncestorOfType<Border>();
        var frontField = front?.FindAncestorOfType<Border>();
        foreach (var ancestor in source.GetVisualAncestors())
        {
            if (ReferenceEquals(ancestor, backField))
                return FlashcardEditorSide.Back;
            if (ReferenceEquals(ancestor, frontField))
                return FlashcardEditorSide.Front;
        }
        return null;
    }

    // --- Tags ---------------------------------------------------------------------------------

    private void OnAddTagPressed(object? sender, PointerPressedEventArgs e)
    {
        (DataContext as FlashcardCardEditorViewModel)?.BeginAddTagCommand.Execute(null);
    }

    private void OnRequestFocusTagInput(object? sender, EventArgs e)
    {
        var box = this.FindControl<TextBox>("TagInput");
        Dispatcher.UIThread.Post(() =>
        {
            box?.Focus();
            box?.SelectAll();
        }, DispatcherPriority.Loaded);
    }

    private void OnTagInputKeyDown(object? sender, KeyEventArgs e)
    {
        if (DataContext is not FlashcardCardEditorViewModel vm)
            return;
        if (e.Key == Key.Enter || e.Key == Key.Return)
        {
            e.Handled = true;
            vm.CommitTagCommand.Execute(null);
        }
        else if (e.Key == Key.Escape)
        {
            e.Handled = true;
            vm.CancelAddTagCommand.Execute(null);
        }
    }

    private void OnTagInputLostFocus(object? sender, RoutedEventArgs e)
    {
        if (DataContext is FlashcardCardEditorViewModel { IsAddingTag: true } vm)
            vm.CommitTagCommand.Execute(null);
    }

    // --- Launchers ----------------------------------------------------------------------------

    /// <summary>Add mode: draft a new card targeting <paramref name="deckId"/> (picker changeable).</summary>
    public static void Open(IOverlayService overlayService, IServiceProvider services, string deckId)
    {
        var (view, vm, close) = Create(overlayService, services);
        view.CloseRequested = close;
        _ = vm.InitializeForAddAsync(deckId);
    }

    /// <summary>Edit mode: load <paramref name="cardId"/>, primary = Save, closes on save.</summary>
    public static void OpenForEdit(IOverlayService overlayService, IServiceProvider services, string cardId)
    {
        var (view, vm, close) = Create(overlayService, services);
        view.CloseRequested = close;
        _ = vm.InitializeForEditAsync(cardId);
    }

    private static (FlashcardCardEditorOverlay View, FlashcardCardEditorViewModel Vm, Action Close) Create(
        IOverlayService overlayService, IServiceProvider services)
    {
        ArgumentNullException.ThrowIfNull(overlayService);
        ArgumentNullException.ThrowIfNull(services);

        var vm = services.GetRequiredService<FlashcardCardEditorViewModel>();
        var view = new FlashcardCardEditorOverlay { DataContext = vm };

        var overlayId = overlayService.CreateOverlay(view, new OverlayOptions
        {
            HorizontalAlignment = Avalonia.Layout.HorizontalAlignment.Center,
            VerticalAlignment = Avalonia.Layout.VerticalAlignment.Center,
            ShowBackdrop = true,
            CloseOnOutsideClick = true
        }, "FlashcardCardEditor");

        return (view, vm, () => overlayService.CloseOverlay(overlayId));
    }
}
