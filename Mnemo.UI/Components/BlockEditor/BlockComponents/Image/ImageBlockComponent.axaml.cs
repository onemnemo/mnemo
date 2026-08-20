using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Threading.Tasks;
using Microsoft.Extensions.DependencyInjection;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Input;
using Avalonia.Input.Platform;
using Avalonia.Interactivity;
using Avalonia.Media;
using Avalonia.Media.Imaging;
using Avalonia.Platform.Storage;
using Avalonia.Layout;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Mnemo.Core.Formatting;
using Mnemo.Core.Models;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Common;
using Mnemo.UI;
using Mnemo.UI.Components.BlockEditor;
using Mnemo.UI.Services;

namespace Mnemo.UI.Components.BlockEditor.BlockComponents.Image;

public partial class ImageBlockComponent : BlockComponentBase
{
    private enum PlaceholderVisualState
    {
        Empty,
        Importing,
        Error
    }

    private readonly IImageAssetService? _imageAssetService;
    private readonly ILocalizationService? _loc;
    private static readonly HttpClient ImageDropHttpClient = new();
    private static readonly HashSet<string> SupportedImageExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".tiff", ".tif"
    };

    private Bitmap? _currentBitmap;
    private bool _isResizing;
    private double _resizeDragStartX;
    private double _resizeDragStartWidth;
    private double? _resizePendingWidth;
    private bool _resizeMutationCompleted;

    private Point? _imageReorderPressPoint;
    private PointerPressedEventArgs? _imageReorderPressArgs;
    private bool _imageReorderDragLaunched;

    /// <summary>Device-independent px before a press on the bitmap becomes a block reorder drag.</summary>
    private const double ImageReorderDragThresholdPixels = 6;

    /// <summary>
    /// BlockContainer padding (16) + add column (30) + drag column (30). Content column = list row width minus this.
    /// See EditableBlock.axaml.
    /// </summary>
    private const double BlockItemContentChromeInset = 76;

    /// <summary>Hard cap so huge monitors do not allow absurd image widths.</summary>
    private const double MaxImageWidthCap = 1600;

    /// <summary>Hit target and selection padding around the image when loaded (Host is a Border).</summary>
    private const double LoadedImageHitPadding = 6;

    private string _captionWatermarkText = string.Empty;
    private PlaceholderVisualState _placeholderVisualState = PlaceholderVisualState.Empty;

    public ImageBlockComponent()
    {
        var services = (Application.Current as App)?.Services;
        _imageAssetService = services?.GetService(typeof(IImageAssetService)) as IImageAssetService;
        _loc = services?.GetService(typeof(ILocalizationService)) as ILocalizationService;

        InitializeComponent();
        PlaceholderBorder.AddHandler(DragDrop.DragOverEvent, Placeholder_DragOver);
        PlaceholderBorder.AddHandler(DragDrop.DropEvent, Placeholder_Drop);

        WireRichTextEditor(CaptionRichTextEditor);
        EditorTextChanged += (_, _) => RefreshCaptionWatermark();

        DataContextChanged += OnDataContextChanged;
    }

    private void OnHoverHostLayoutUpdated(object? sender, EventArgs e)
    {
        ClampImageWidthToViewport();
        UpdateCaptionHostWidth();
    }

    private string T(string key) => _loc?.T(key, "NotesEditor") ?? key;

    public override Control? GetInputControl() => CaptionRichTextEditor;

    /// <summary>Image/placeholder row used to vertically align the block gutter with the first visual line of the block.</summary>
    public Grid? GutterAnchorRow => ImageContentRow;

    protected override void OnAttachedToVisualTree(VisualTreeAttachmentEventArgs e)
    {
        base.OnAttachedToVisualTree(e);
        if (HoverHost != null)
            HoverHost.LayoutUpdated += OnHoverHostLayoutUpdated;
        SetLocalizationStrings();
        SyncFromViewModel();
    }

    protected override void OnDetachedFromVisualTree(VisualTreeAttachmentEventArgs e)
    {
        if (HoverHost != null)
            HoverHost.LayoutUpdated -= OnHoverHostLayoutUpdated;
        CompleteResizeMutation();
        EndResizeSession();
        base.OnDetachedFromVisualTree(e);
        DisposeBitmap();
    }

    private void OnDataContextChanged(object? sender, EventArgs e)
    {
        SetLocalizationStrings();
        SyncFromViewModel();
    }

    private void SetLocalizationStrings()
    {
        _captionWatermarkText = T("ImageCaptionPlaceholder");
        if (PlaceholderEmptyTitle != null)
            PlaceholderEmptyTitle.Text = TFallback("ImagePlaceholderAddTitle", "Add an image");
        if (PlaceholderEmptySubtitle != null)
            PlaceholderEmptySubtitle.Text = TFallback("ImagePlaceholderAddSubtitle", "Click to upload, or drag and drop here");
        if (PlaceholderEmptyFormats != null)
            PlaceholderEmptyFormats.Text = TFallback("ImagePlaceholderFormats", "PNG, JPG, GIF, or WebP");
        if (PlaceholderImportingTitle != null)
            PlaceholderImportingTitle.Text = TFallback("ImagePlaceholderImportingTitle", "Importing image...");
        if (PlaceholderImportingSubtitle != null)
            PlaceholderImportingSubtitle.Text = TFallback("ImagePlaceholderImportingSubtitle", "Reading the file and preparing a preview");
        if (PlaceholderErrorTitle != null)
            PlaceholderErrorTitle.Text = TFallback("ImagePlaceholderErrorTitle", "Image could not be imported");
        if (PlaceholderErrorSubtitle != null)
            PlaceholderErrorSubtitle.Text = TFallback("ImagePlaceholderErrorSubtitle", "Try another file or check the image format.");
        if (PlaceholderTryAgainButton != null)
            PlaceholderTryAgainButton.Content = TFallback("ImagePlaceholderTryAgainButton", "Try again");
        RefreshCaptionWatermark();

        void SetPh(MenuItem? m, string key) { if (m != null) m.Header = T(key); }
        SetPh(FlyoutReplaceItem, "ImageFlyoutReplace");
        SetPh(FlyoutCopyItem, "ImageFlyoutCopyImage");
        SetPh(FlyoutDuplicateItem, "ImageFlyoutDuplicate");
        SetPh(FlyoutDeleteItem, "ImageFlyoutDelete");
        SetPh(PhFlyoutReplaceItem, "ImageFlyoutReplace");
        SetPh(PhFlyoutCopyItem, "ImageFlyoutCopyImage");
        SetPh(PhFlyoutDuplicateItem, "ImageFlyoutDuplicate");
        SetPh(PhFlyoutDeleteItem, "ImageFlyoutDelete");

        void SetAlignTip(Button? b, string key)
        {
            if (b != null)
                ToolTip.SetTip(b, T(key));
        }

        SetAlignTip(PhAlignFlyoutLeftBtn, "ImageAlignLeftTooltip");
        SetAlignTip(PhAlignFlyoutCenterBtn, "ImageAlignCenterTooltip");
        SetAlignTip(PhAlignFlyoutRightBtn, "ImageAlignRightTooltip");
        SetAlignTip(LdAlignFlyoutLeftBtn, "ImageAlignLeftTooltip");
        SetAlignTip(LdAlignFlyoutCenterBtn, "ImageAlignCenterTooltip");
        SetAlignTip(LdAlignFlyoutRightBtn, "ImageAlignRightTooltip");

        ApplyPlaceholderVisualState();
    }

    private string TFallback(string key, string fallback)
    {
        var translated = T(key);
        return string.Equals(translated, key, StringComparison.Ordinal) ? fallback : translated;
    }

    private void RefreshCaptionWatermark()
    {
        if (CaptionRichTextEditor == null) return;
        var over = HoverHost?.IsPointerOver == true;
        CaptionRichTextEditor.Watermark = over && string.IsNullOrEmpty(CaptionRichTextEditor.Text)
            ? _captionWatermarkText
            : null;
    }

    private void SyncFromViewModel()
    {
        var vm = ViewModel;
        if (vm == null) return;

        var imagePath = vm.ImagePath;
        var imageWidth = vm.ImageWidth;

        ApplyImageWidth(imageWidth);
        ClampImageWidthToViewport();

        if (string.IsNullOrEmpty(imagePath) || !File.Exists(imagePath))
        {
            ShowPlaceholder();
        }
        else
        {
            LoadBitmap(imagePath);
        }

        UpdateAlignButtonIcons();
    }

    private void LoadBitmap(string path)
    {
        DisposeBitmap();
        try
        {
            _currentBitmap = new Bitmap(path);
            DisplayImage.Source = _currentBitmap;
            ShowImageArea();
        }
        catch
        {
            ShowPlaceholder();
        }
    }

    private void DisposeBitmap()
    {
        if (_currentBitmap != null)
        {
            DisplayImage.Source = null;
            _currentBitmap.Dispose();
            _currentBitmap = null;
        }
    }

    private void ShowPlaceholder()
    {
        _placeholderVisualState = PlaceholderVisualState.Empty;
        PlaceholderBorder.IsVisible = true;
        LoadedImageRow.IsVisible = false;
        LoadedToolbar.IsVisible = false;
        PlaceholderToolbar.IsVisible = false;
        ApplyPlaceholderVisualState();
        ApplyHorizontalLayoutForContentState();
        UpdateCaptionHostWidth();
        UpdateResizeChromeVisibility();
    }

    private void ShowImageArea()
    {
        PlaceholderBorder.IsVisible = false;
        LoadedImageRow.IsVisible = true;
        PlaceholderToolbar.IsVisible = false;
        ApplyHorizontalLayoutForContentState();
        UpdateCaptionHostWidth();
        UpdateResizeChromeVisibility();
    }

    private void SetPlaceholderVisualState(PlaceholderVisualState state)
    {
        _placeholderVisualState = state;
        ApplyPlaceholderVisualState();
    }

    private void ApplyPlaceholderVisualState()
    {
        if (PlaceholderEmptyState == null || PlaceholderImportingState == null || PlaceholderErrorState == null || PlaceholderBorder == null)
            return;

        PlaceholderEmptyState.IsVisible = _placeholderVisualState == PlaceholderVisualState.Empty;
        PlaceholderImportingState.IsVisible = _placeholderVisualState == PlaceholderVisualState.Importing;
        PlaceholderErrorState.IsVisible = _placeholderVisualState == PlaceholderVisualState.Error;

        if (_placeholderVisualState == PlaceholderVisualState.Error)
        {
            if (PlaceholderBorder.TryFindResource("SystemErrorTextColor", out var errorBrushObj)
                && errorBrushObj is IBrush errorBrush)
                PlaceholderBorder.BorderBrush = errorBrush;
        }
        else if (PlaceholderBorder.TryFindResource("SystemControlForegroundBaseMediumBrush", out var normalBrushObj)
                 && normalBrushObj is IBrush normalBrush)
        {
            PlaceholderBorder.BorderBrush = normalBrush;
        }
    }

    private void LoadedImageRow_PointerEntered(object? sender, PointerEventArgs e) => UpdateResizeChromeVisibility();

    private void LoadedImageRow_PointerExited(object? sender, PointerEventArgs e) => UpdateResizeChromeVisibility();

    /// <summary>Resize affordance only while pointer is over the image row (not the caption).</summary>
    private void UpdateResizeChromeVisibility()
    {
        if (ResizeHitBorder == null || LoadedImageRow == null) return;
        if (!LoadedImageRow.IsVisible)
        {
            ResizeHitBorder.IsVisible = false;
            return;
        }
        ResizeHitBorder.IsVisible = _isResizing || LoadedImageRow.IsPointerOver;
    }

    private void UpdateCaptionHostWidth()
    {
        if (CaptionHost == null) return;
        if (LoadedImageRow.IsVisible && DisplayImage != null && DisplayImage.Bounds.Width > 0)
        {
            CaptionHost.Width = DisplayImage.Bounds.Width;
            CaptionHost.HorizontalAlignment = HorizontalAlignment.Left; // caption hugs image
        }
        else
        {
            CaptionHost.Width = double.NaN;
            CaptionHost.HorizontalAlignment = HorizontalAlignment.Stretch;
        }
    }

    private void ApplyHorizontalLayoutForContentState()
    {
        // Alignment is handled by the parent EditableBlock (this.HorizontalAlignment).
        // Inner content stays shrink-wrapped so selection hugs the image.
        var isLoadedImage = LoadedImageRow.IsVisible;

        if (isLoadedImage)
        {
            HorizontalAlignment = HorizontalAlignment.Left; // shrink-wrap; parent EditableBlock aligns
            if (HoverHost != null)
            {
                HoverHost.HorizontalAlignment = HorizontalAlignment.Left;
                HoverHost.Padding = new Thickness(LoadedImageHitPadding);
            }
            if (RootGrid != null)
                RootGrid.HorizontalAlignment = HorizontalAlignment.Left;
            if (ImageContentRow != null)
                ImageContentRow.HorizontalAlignment = HorizontalAlignment.Left;
            if (LoadedImageRow != null)
                LoadedImageRow.HorizontalAlignment = HorizontalAlignment.Left;
        }
        else
        {
            HorizontalAlignment = HorizontalAlignment.Stretch;
            if (HoverHost != null)
            {
                HoverHost.HorizontalAlignment = HorizontalAlignment.Stretch;
                HoverHost.Padding = default;
            }
            if (RootGrid != null)
                RootGrid.HorizontalAlignment = HorizontalAlignment.Stretch;
            if (ImageContentRow != null)
                ImageContentRow.HorizontalAlignment = HorizontalAlignment.Stretch;
        }
    }

    // ── Hover host (menu visibility + keyboard focus) ─────────────────────────

    private void HoverHost_PointerEntered(object? sender, PointerEventArgs e)
    {
        if (LoadedImageRow.IsVisible)
        {
            LoadedToolbar.IsVisible = true;
            LoadedToolbar.Opacity = 1;
        }
        if (PlaceholderBorder.IsVisible && _placeholderVisualState != PlaceholderVisualState.Importing)
        {
            PlaceholderToolbar.IsVisible = true;
            PlaceholderToolbar.Opacity = 1;
        }
        RefreshCaptionWatermark();
    }

    private void HoverHost_PointerExited(object? sender, PointerEventArgs e)
    {
        if (FlyoutButton.Flyout?.IsOpen == true || FlyoutButtonPlaceholder.Flyout?.IsOpen == true)
            return;
        if (IsAnyAlignFlyoutOpen())
            return;

        LoadedToolbar.Opacity = 0;
        LoadedToolbar.IsVisible = false;
        PlaceholderToolbar.Opacity = 0;
        PlaceholderToolbar.IsVisible = false;
        RefreshCaptionWatermark();
    }

    private bool IsAnyAlignFlyoutOpen() =>
        AlignMenuButton.Flyout is { IsOpen: true } || AlignMenuButtonPlaceholder.Flyout is { IsOpen: true };

    private void HideAlignFlyouts()
    {
        // Defer closing by one UI tick so the current pointer/click route can complete
        // before PopupRoot is detached; avoids transient "PlatformImpl is null" input logs.
        Dispatcher.UIThread.Post(() =>
        {
            if (AlignMenuButton.Flyout is FlyoutBase f1 && f1.IsOpen)
                f1.Hide();
            if (AlignMenuButtonPlaceholder.Flyout is FlyoutBase f2 && f2.IsOpen)
                f2.Hide();
        }, DispatcherPriority.Background);
    }

    private static string NormalizeImageAlign(string? value) =>
        value?.Trim().ToLowerInvariant() switch
        {
            "center" => "center",
            "right" => "right",
            _ => "left",
        };

    private string GetImageAlignFromMeta()
    {
        var vm = ViewModel;
        if (vm == null) return "left";
        return NormalizeImageAlign(vm.ImageAlign);
    }

    private void UpdateAlignButtonIcons()
    {
        var align = GetImageAlignFromMeta();
        var path = align switch
        {
            "center" => "avares://Mnemo.UI/Icons/Editor/align-center.svg",
            "right" => "avares://Mnemo.UI/Icons/Editor/align-right.svg",
            _ => "avares://Mnemo.UI/Icons/Editor/align-left.svg",
        };
        if (AlignButtonIcon != null)
            AlignButtonIcon.SvgPath = path;
        if (AlignButtonIconPlaceholder != null)
            AlignButtonIconPlaceholder.SvgPath = path;
    }

    private void SetImageAlign(string value)
    {
        var vm = ViewModel;
        if (vm == null) return;
        var normalized = NormalizeImageAlign(value);
        if (string.Equals(vm.ImageAlign, normalized, StringComparison.Ordinal))
            return;
        vm.NotifyStructuralChangeStarting();
        vm.ImageAlign = normalized;
        vm.NotifyStructuralChangeCompleted("Change image alignment");
        UpdateAlignButtonIcons();
        // EditableBlock listens to Meta changes and updates its HorizontalAlignment
    }

    private void AlignPickLeft_Click(object? sender, RoutedEventArgs e)
    {
        SetImageAlign("left");
        HideAlignFlyouts();
    }

    private void AlignPickCenter_Click(object? sender, RoutedEventArgs e)
    {
        SetImageAlign("center");
        HideAlignFlyouts();
    }

    private void AlignPickRight_Click(object? sender, RoutedEventArgs e)
    {
        SetImageAlign("right");
        HideAlignFlyouts();
    }

    /// <summary>
    /// Keyboard focus for Delete/Back; only from image chrome, not from <see cref="HoverHost"/>
    /// (ancestor handlers run in the same route as toolbar <see cref="Button"/>s and break Flyout/MenuFlyout).
    /// </summary>
    private void ImageChrome_PointerPressed(object? sender, PointerPressedEventArgs e)
    {
        if (!e.GetCurrentPoint(this).Properties.IsLeftButtonPressed) return;
        HoverHost?.Focus();

        if (sender is not Border border || !ReferenceEquals(border, ImageInnerBorder)) return;

        _imageReorderDragLaunched = false;
        _imageReorderPressPoint = e.GetPosition(ImageInnerBorder);
        _imageReorderPressArgs = e;
        e.Pointer.Capture(ImageInnerBorder);
    }

    private void ImageChrome_PointerMoved(object? sender, PointerEventArgs e)
    {
        if (!_imageReorderPressPoint.HasValue || _imageReorderDragLaunched) return;
        if (!ReferenceEquals(e.Pointer.Captured, ImageInnerBorder)) return;
        if (!e.GetCurrentPoint(this).Properties.IsLeftButtonPressed) return;

        var p = e.GetPosition(ImageInnerBorder);
        var origin = _imageReorderPressPoint.Value;
        var dist = Math.Sqrt((p.X - origin.X) * (p.X - origin.X) + (p.Y - origin.Y) * (p.Y - origin.Y));
        if (dist >= ImageReorderDragThresholdPixels)
        {
            _imageReorderDragLaunched = true;
            // No StandardCursorType.Grab on all platforms; DragMove is the reorder-drag affordance.
            ImageInnerBorder.Cursor = new Cursor(StandardCursorType.DragMove);
            _ = RunImageReorderDragAsync(e);
        }
    }

    private void ImageChrome_PointerReleased(object? sender, PointerReleasedEventArgs e)
    {
        if (ReferenceEquals(e.Pointer.Captured, ImageInnerBorder))
            e.Pointer.Capture(null);
        ClearImageReorderGestureState();
    }

    private void ImageChrome_PointerCaptureLost(object? sender, PointerCaptureLostEventArgs e)
    {
        // Releasing capture to start DoDragDrop fires this. Do not clear; RunImageReorderDragAsync clears after drop.
        if (_imageReorderDragLaunched)
            return;
        ClearImageReorderGestureState();
    }

    private void ClearImageReorderGestureState()
    {
        _imageReorderPressPoint = null;
        _imageReorderPressArgs = null;
        _imageReorderDragLaunched = false;
        if (ImageInnerBorder != null)
            ImageInnerBorder.Cursor = Cursor.Default;
    }

    private async Task RunImageReorderDragAsync(PointerEventArgs e)
    {
        try
        {
            if (_imageReorderPressArgs == null)
                return;

            // DoDragDrop expects no prior capture (same as gutter drag handle).
            if (ReferenceEquals(_imageReorderPressArgs.Pointer.Captured, ImageInnerBorder))
                _imageReorderPressArgs.Pointer.Capture(null);

            var eb = this.GetVisualAncestors().OfType<EditableBlock>().FirstOrDefault();
            if (eb != null)
                await eb.BeginBlockReorderDragCoreAsync(_imageReorderPressArgs).ConfigureAwait(true);
        }
        finally
        {
            ClearImageReorderGestureState();
        }
    }

    private void HoverHost_KeyDown(object? sender, KeyEventArgs e)
    {
        if (e.Handled) return;
        if ((e.KeyModifiers & (KeyModifiers.Control | KeyModifiers.Alt | KeyModifiers.Meta)) != 0)
            return;

        // Image block often focuses HoverHost (see FocusManager); same vertical-arrow rules as KeyboardHandler
        // so Avalonia's window XY navigation does not eat Up/Down before the caption editor runs.
        if ((e.Key == Key.Up || e.Key == Key.Down) && CaptionRichTextEditor != null)
        {
            e.Handled = true;
            CaptionRichTextEditor.Focus();
            var shift = e.KeyModifiers.HasFlag(KeyModifiers.Shift);
            if (e.Key == Key.Up)
            {
                if (!CaptionRichTextEditor.TryVerticalLogicalNavigation(shift, up: true))
                {
                    var px = CaptionRichTextEditor.TryGetCaretHorizontalOffsetForBlockNavigation(out var x) ? x : (double?)null;
                    ViewModel?.RequestFocusPrevious(px);
                }
            }
            else if (!CaptionRichTextEditor.TryVerticalLogicalNavigation(shift, up: false))
            {
                var px = CaptionRichTextEditor.TryGetCaretHorizontalOffsetForBlockNavigation(out var x) ? x : (double?)null;
                ViewModel?.RequestFocusNext(px);
            }

            return;
        }

        if (e.Key == Key.Delete)
        {
            ViewModel?.NotifyStructuralChangeStarting();
            ViewModel?.RequestDelete();
            e.Handled = true;
            return;
        }

        if (e.Key == Key.Back)
        {
            ViewModel?.NotifyStructuralChangeStarting();
            ViewModel?.RequestDeleteAndFocusAbove();
            e.Handled = true;
        }
    }

    // ── Import ────────────────────────────────────────────────────────────────

    private async void Placeholder_PointerPressed(object? sender, PointerPressedEventArgs e)
    {
        if (_placeholderVisualState == PlaceholderVisualState.Importing)
            return;
        if (!e.GetCurrentPoint(this).Properties.IsLeftButtonPressed) return;
        if (IsVisualDescendantOf(e.Source as Visual, PlaceholderToolbar))
            return;
        e.Handled = true;
        await ImportImageAsync();
    }

    private void Placeholder_DragOver(object? sender, DragEventArgs e)
    {
        if (CanImportImageFromDataTransfer(e.DataTransfer))
        {
            e.DragEffects = DragDropEffects.Copy;
            e.Handled = true;
            return;
        }

        e.DragEffects = DragDropEffects.None;
    }

    private async void Placeholder_Drop(object? sender, DragEventArgs e)
    {
        if (e.DataTransfer is not IAsyncDataTransfer asyncTransfer)
            return;

        var vm = ViewModel;
        if (vm == null)
            return;

        // Mark handled before awaiting so parent BlockEditor drop handlers do not
        // also process this same external image drop and insert a duplicate block.
        e.Handled = true;
        SetPlaceholderVisualState(PlaceholderVisualState.Importing);
        var importedPath = await TryImportImageFromDropAsync(asyncTransfer, vm.Id).ConfigureAwait(true);
        if (string.IsNullOrWhiteSpace(importedPath))
        {
            SetPlaceholderVisualState(PlaceholderVisualState.Error);
            return;
        }

        vm.NotifyStructuralChangeStarting();
        vm.ImagePath = importedPath;
        vm.NotifyStructuralChangeCompleted("Drop image into block");
        await Dispatcher.UIThread.InvokeAsync(() => LoadBitmap(importedPath));
    }

    private static bool IsVisualDescendantOf(Visual? node, Visual? ancestor)
    {
        if (node == null || ancestor == null) return false;
        for (Visual? v = node; v != null; v = v.GetVisualParent())
        {
            if (ReferenceEquals(v, ancestor))
                return true;
        }

        return false;
    }

    private static bool CanImportImageFromDataTransfer(IDataTransfer data)
    {
        if (data.Contains(DataFormat.File))
            return true;
        if (data.TryGetValue(DataFormat.Text) is string text
            && (!string.IsNullOrWhiteSpace(GetImageUrlFromText(text)) || IsLocalImagePath(text)))
            return true;
        return data is IAsyncDataTransfer;
    }

    private async Task<string?> TryImportImageFromDropAsync(IAsyncDataTransfer data, string blockId)
    {
        if (_imageAssetService == null)
        {
            return null;
        }

        try
        {
            var files = await data.TryGetFilesAsync().ConfigureAwait(true);
            if (files != null)
            {
                foreach (var f in files)
                {
                    var local = f.TryGetLocalPath();
                    if (string.IsNullOrWhiteSpace(local) || !File.Exists(local))
                        continue;
                    if (!SupportedImageExtensions.Contains(Path.GetExtension(local)))
                        continue;

                    var import = await _imageAssetService.ImportAndCopyAsync(local, blockId).ConfigureAwait(true);
                    if (import.IsSuccess && !string.IsNullOrWhiteSpace(import.Value))
                    {
                        return import.Value;
                    }
                }
            }
        }
        catch
        {
            // Continue to other formats.
        }

        try
        {
            var bmp = await data.TryGetBitmapAsync().ConfigureAwait(true);
            if (bmp != null)
            {
                try
                {
                    var dir = MnemoAppPaths.GetImagesDirectory();
                    Directory.CreateDirectory(dir);
                    var path = Path.Combine(dir, blockId + ".png");
                    bmp.Save(path);
                    return path;
                }
                finally
                {
                    bmp.Dispose();
                }
            }
        }
        catch
        {
            // Continue to text/URL parsing.
        }

        var text = ExtractImageText(data);
        if (string.IsNullOrWhiteSpace(text))
        {
            try
            {
                text = await data.TryGetTextAsync().ConfigureAwait(true);
            }
            catch
            {
                text = null;
            }
        }

        if (string.IsNullOrWhiteSpace(text))
        {
            return null;
        }

        if (IsLocalImagePath(text))
        {
            var local = NormalizeLocalPath(text)!;
            var import = await _imageAssetService.ImportAndCopyAsync(local, blockId).ConfigureAwait(true);
            if (import.IsSuccess && !string.IsNullOrWhiteSpace(import.Value))
            {
                return import.Value;
            }
            return null;
        }

        var url = GetImageUrlFromText(text);
        if (string.IsNullOrWhiteSpace(url))
        {
            return null;
        }

        return await DownloadImageUrlAsync(url, blockId).ConfigureAwait(true);
    }

    private static string? ExtractImageText(IAsyncDataTransfer data) =>
        (data as IDataTransfer)?.TryGetValue(DataFormat.Text) as string;

    private static bool IsLocalImagePath(string text) => NormalizeLocalPath(text) != null;

    private static string? NormalizeLocalPath(string? text)
    {
        if (string.IsNullOrWhiteSpace(text))
            return null;
        var candidate = text.Trim().Trim('"');
        if (candidate.IndexOf('\r') >= 0 || candidate.IndexOf('\n') >= 0)
            return null;
        if (!File.Exists(candidate))
            return null;
        return SupportedImageExtensions.Contains(Path.GetExtension(candidate)) ? candidate : null;
    }

    private static string? GetImageUrlFromText(string? text)
    {
        if (string.IsNullOrWhiteSpace(text))
            return null;
        var line = text.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries)
            .Select(x => x.Trim())
            .FirstOrDefault(x => !string.IsNullOrWhiteSpace(x));
        if (string.IsNullOrWhiteSpace(line))
            return null;
        if (!Uri.TryCreate(line, UriKind.Absolute, out var uri))
            return null;
        if (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps)
            return null;
        return uri.ToString();
    }

    private static async Task<string?> DownloadImageUrlAsync(string url, string blockId)
    {
        try
        {
            using var response = await ImageDropHttpClient.GetAsync(url).ConfigureAwait(true);
            if (!response.IsSuccessStatusCode)
                return null;
            var mediaType = response.Content.Headers.ContentType?.MediaType;
            if (!string.IsNullOrWhiteSpace(mediaType)
                && !mediaType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
                return null;

            var bytes = await response.Content.ReadAsByteArrayAsync().ConfigureAwait(true);
            if (bytes.Length == 0)
                return null;

            if (mediaType is null
                || mediaType.Equals("image/png", StringComparison.OrdinalIgnoreCase)
                || mediaType.Equals("image/jpeg", StringComparison.OrdinalIgnoreCase)
                || mediaType.Equals("image/jpg", StringComparison.OrdinalIgnoreCase)
                || mediaType.Equals("image/gif", StringComparison.OrdinalIgnoreCase)
                || mediaType.Equals("image/bmp", StringComparison.OrdinalIgnoreCase)
                || mediaType.Equals("image/tiff", StringComparison.OrdinalIgnoreCase))
            {
                await using var verify = new MemoryStream(bytes, writable: false);
                try
                {
                    using var _ = new Bitmap(verify);
                }
                catch
                {
                    return null;
                }
            }

            var dir = MnemoAppPaths.GetImagesDirectory();
            Directory.CreateDirectory(dir);
            var ext = GuessImageExtension(response.Content.Headers.ContentType?.MediaType, url);
            var path = Path.Combine(dir, blockId + ext);
            await File.WriteAllBytesAsync(path, bytes).ConfigureAwait(true);
            return path;
        }
        catch
        {
            return null;
        }
    }

    private static string GuessImageExtension(string? mediaType, string url)
    {
        if (!string.IsNullOrWhiteSpace(mediaType))
        {
            if (mediaType.Contains("png", StringComparison.OrdinalIgnoreCase)) return ".png";
            if (mediaType.Contains("jpeg", StringComparison.OrdinalIgnoreCase) || mediaType.Contains("jpg", StringComparison.OrdinalIgnoreCase)) return ".jpg";
            if (mediaType.Contains("gif", StringComparison.OrdinalIgnoreCase)) return ".gif";
            if (mediaType.Contains("webp", StringComparison.OrdinalIgnoreCase)) return ".webp";
            if (mediaType.Contains("bmp", StringComparison.OrdinalIgnoreCase)) return ".bmp";
            if (mediaType.Contains("tiff", StringComparison.OrdinalIgnoreCase)) return ".tiff";
        }

        var ext = Path.GetExtension(url);
        return SupportedImageExtensions.Contains(ext) ? ext : ".png";
    }

    private async Task ImportImageAsync()
    {
        var vm = ViewModel;
        if (vm == null || _imageAssetService == null) return;

        var topLevel = TopLevel.GetTopLevel(this);
        if (topLevel == null) return;

        var files = await topLevel.StorageProvider.OpenFilePickerAsync(new FilePickerOpenOptions
        {
            Title = T("Image"),
            AllowMultiple = false,
            FileTypeFilter = new[]
            {
                new FilePickerFileType("Images")
                {
                    Patterns = new[] { "*.png", "*.jpg", "*.jpeg", "*.gif", "*.bmp", "*.webp", "*.tiff" }
                }
            }
        });

        if (files.Count == 0)
        {
            return;
        }

        SetPlaceholderVisualState(PlaceholderVisualState.Importing);

        var sourcePath = files[0].TryGetLocalPath();
        if (string.IsNullOrEmpty(sourcePath))
        {
            SetPlaceholderVisualState(PlaceholderVisualState.Error);
            return;
        }

        var result = await _imageAssetService.ImportAndCopyAsync(sourcePath, vm.Id);
        if (!result.IsSuccess)
        {
            SetPlaceholderVisualState(PlaceholderVisualState.Error);
            return;
        }

        vm.NotifyStructuralChangeStarting();
        vm.ImagePath = result.Value!;
        vm.NotifyStructuralChangeCompleted("Import image");

        await Dispatcher.UIThread.InvokeAsync(() => LoadBitmap(result.Value!));
    }

    private async void PlaceholderTryAgainButton_Click(object? sender, RoutedEventArgs e)
    {
        if (_placeholderVisualState == PlaceholderVisualState.Importing)
            return;
        await ImportImageAsync();
    }

    // ── Flyout (Button.Flyout opens automatically, no extra Click handler) ───

    private async void FlyoutReplace_Click(object? sender, RoutedEventArgs e)
    {
        var vm = ViewModel;
        if (vm == null || _imageAssetService == null) return;

        var previousStoredPath = vm.ImagePath;

        var topLevel = TopLevel.GetTopLevel(this);
        if (topLevel == null) return;

        var files = await topLevel.StorageProvider.OpenFilePickerAsync(new FilePickerOpenOptions
        {
            Title = T("ImageFlyoutReplace"),
            AllowMultiple = false,
            FileTypeFilter = new[]
            {
                new FilePickerFileType("Images")
                {
                    Patterns = new[] { "*.png", "*.jpg", "*.jpeg", "*.gif", "*.bmp", "*.webp", "*.tiff" }
                }
            }
        });

        if (files.Count == 0) return;

        var sourcePath = files[0].TryGetLocalPath();
        if (string.IsNullOrEmpty(sourcePath)) return;

        var result = await _imageAssetService.ImportAndCopyAsync(sourcePath, vm.Id);
        if (!result.IsSuccess) return;

        var editor = this.FindAncestorOfType<BlockEditor>();
        if (!string.Equals(previousStoredPath, result.Value, StringComparison.OrdinalIgnoreCase))
            editor?.RegisterReleasedStoredImagePath(previousStoredPath);

        vm.NotifyStructuralChangeStarting();
        vm.ImagePath = result.Value!;
        vm.NotifyStructuralChangeCompleted("Replace image");

        await Dispatcher.UIThread.InvokeAsync(() => LoadBitmap(result.Value!));
    }

    private async void FlyoutCopy_Click(object? sender, RoutedEventArgs e)
    {
        var vm = ViewModel;
        if (vm == null) return;

        var imagePath = vm.ImagePath;
        if (string.IsNullOrEmpty(imagePath) || !File.Exists(imagePath)) return;

        var topLevel = TopLevel.GetTopLevel(this);
        if (topLevel?.Clipboard == null) return;

        var sp = (Application.Current as App)?.Services;
        var noteSvc = sp?.GetService(typeof(INoteClipboardPlatformService)) as INoteClipboardPlatformService;
        var codec = sp?.GetService(typeof(INoteClipboardPayloadCodec)) as INoteClipboardPayloadCodec;

        if (noteSvc != null && codec != null)
        {
            var list = new List<BlockViewModel> { vm };
            var markdown = BlockMarkdownSerializer.Serialize(list);
            var json = codec.Serialize(EditorClipboardMapper.ToDocument(list));
            Bitmap? bmp = null;
            try
            {
                bmp = new Bitmap(imagePath);
                await noteSvc.WriteAsync(topLevel.Clipboard, markdown, json, bmp).ConfigureAwait(true);
            }
            finally
            {
                bmp?.Dispose();
            }
            return;
        }

        Bitmap? fallback = null;
        try
        {
            fallback = new Bitmap(imagePath);
            await topLevel.Clipboard.SetBitmapAsync(fallback).ConfigureAwait(true);
        }
        finally
        {
            fallback?.Dispose();
        }
    }

    private void FlyoutDuplicate_Click(object? sender, RoutedEventArgs e)
    {
        ViewModel?.RequestDuplicateBlock();
    }

    private void FlyoutDelete_Click(object? sender, RoutedEventArgs e)
    {
        ViewModel?.NotifyStructuralChangeStarting();
        ViewModel?.RequestDelete();
    }

    // ── Resize handle (global pointer tracking while dragging) ────────────────

    private void ResizePill_PointerEntered(object? sender, PointerEventArgs e)
    {
        ResizePill.Opacity = 0.4;
    }

    private void ResizePill_PointerExited(object? sender, PointerEventArgs e)
    {
        if (!_isResizing)
            ResizePill.Opacity = 0.15;
    }

    private void ResizePill_PointerPressed(object? sender, PointerPressedEventArgs e)
    {
        if (!e.GetCurrentPoint(this).Properties.IsLeftButtonPressed) return;

        _isResizing = true;
        _resizeDragStartX = e.GetPosition(this).X;
        _resizePendingWidth = null;
        _resizeMutationCompleted = false;
        var maxW = GetMaxImageDisplayWidth();
        var currentWidth = DisplayImage.Width;
        var raw = !double.IsNaN(currentWidth) && currentWidth > 0
            ? currentWidth
            : (DisplayImage.Bounds.Width > 0 ? DisplayImage.Bounds.Width : 200);
        _resizeDragStartWidth = Math.Clamp(raw, 80, maxW);
        ViewModel?.NotifyStructuralChangeStarting();

        // We capture the outer border (sender) instead of the inner pill
        if (sender is InputElement element)
        {
            element.Cursor = new Cursor(StandardCursorType.SizeWestEast);
            e.Pointer.Capture(element);
        }
        e.Handled = true;
    }

    private void ResizeHitArea_PointerMoved(object? sender, PointerEventArgs e)
    {
        ResizeGlobal_PointerMoved(e);
    }

    private void ResizeHitArea_PointerReleased(object? sender, PointerReleasedEventArgs e)
    {
        ResizeGlobal_PointerReleased(e);
    }

    private void ResizeHitArea_PointerCaptureLost(object? sender, PointerCaptureLostEventArgs e)
    {
        CompleteResizeMutation();
        EndResizeSession();
    }

    private void EndResizeSession()
    {
        if (!_isResizing) return;
        _isResizing = false;
        _resizeMutationCompleted = false;
        if (ResizePill != null)
            ResizePill.Opacity = 0.15;
        UpdateResizeChromeVisibility();
    }

    private void ResizeGlobal_PointerMoved(PointerEventArgs e)
    {
        if (!_isResizing) return;

        var delta = e.GetPosition(this).X - _resizeDragStartX;
        var maxW = GetMaxImageDisplayWidth();
        var newWidth = Math.Clamp(_resizeDragStartWidth + delta, 80, maxW);

        DisplayImage.Width = newWidth;
        _resizePendingWidth = newWidth;
    }

    private void ResizeGlobal_PointerReleased(PointerReleasedEventArgs e)
    {
        if (!_isResizing) return;

        CompleteResizeMutation();
        e.Pointer.Capture(null);
        EndResizeSession();
    }

    private void CompleteResizeMutation()
    {
        if (_resizeMutationCompleted)
            return;

        var vm = ViewModel;
        if (vm == null)
        {
            _resizePendingWidth = null;
            _resizeMutationCompleted = true;
            return;
        }

        if (_resizePendingWidth.HasValue)
        {
            var pending = _resizePendingWidth.Value;
            if (Math.Abs(vm.ImageWidth - pending) > 0.25)
                vm.ImageWidth = pending;
        }

        _resizePendingWidth = null;
        vm.NotifyStructuralChangeCompleted("Resize image");
        _resizeMutationCompleted = true;
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /// <summary>
    /// Max width for the block body (star column), from the list item row width, not the shrink-wrapped
    /// content chrome bounds (those match the current image width and would block scaling up).
    /// </summary>
    private double GetContentColumnConstraintWidth()
    {
        for (Visual? p = this.GetVisualParent(); p != null; p = p.GetVisualParent())
        {
            if (p is EditableBlock eb && eb.GetVisualParent() is Control slot && slot.Bounds.Width > 0)
                return Math.Max(0, slot.Bounds.Width - BlockItemContentChromeInset);

            // BlocksItemsControl is an ItemsRepeater after virtualization migration; match the
            // named element regardless of concrete type.
            if (p is Control c && string.Equals(c.Name, "BlocksItemsControl", StringComparison.Ordinal)
                && c.Bounds.Width > 0)
                return Math.Max(0, c.Bounds.Width - BlockItemContentChromeInset);

            if (p is BlockEditor be && be.Bounds.Width > 0)
            {
                const double editorHorizontalPadding = 64; // BlockEditor.axaml Border Padding 32,0,32,0
                return Math.Max(0, be.Bounds.Width - editorHorizontalPadding - BlockItemContentChromeInset);
            }
        }

        return 0;
    }

    private double GetMaxImageDisplayWidth()
    {
        double colW = GetContentColumnConstraintWidth();
        var innerPad = LoadedImageRow.IsVisible ? LoadedImageHitPadding * 2 : 0;
        var byViewport = colW > 0
            ? Math.Clamp(colW - innerPad, 80, MaxImageWidthCap)
            : MaxImageWidthCap;

        // When the image has a taller-than-wide aspect ratio, the MaxHeight="600" constraint
        // means the rendered width never reaches the full byViewport. Cap the drag accordingly.
        if (_currentBitmap != null)
        {
            var px = _currentBitmap.PixelSize;
            if (px.Height > 0 && px.Width > 0)
            {
                const double maxHeight = 600.0;
                var aspectCap = maxHeight * ((double)px.Width / px.Height);
                byViewport = Math.Min(byViewport, aspectCap);
            }
        }

        return byViewport;
    }

    private void ClampImageWidthToViewport()
    {
        if (DisplayImage == null || !LoadedImageRow.IsVisible) return;

        var maxW = GetMaxImageDisplayWidth();
        var w = DisplayImage.Width;

        if (double.IsNaN(w) || w <= 0)
        {
            var rendered = DisplayImage.Bounds.Width;
            if (rendered > maxW)
            {
                DisplayImage.Width = maxW;
                PersistClampedWidth(maxW);
            }
            return;
        }

        if (w > maxW)
        {
            DisplayImage.Width = maxW;
            PersistClampedWidth(maxW);
        }
    }

    private void PersistClampedWidth(double width)
    {
        var vm = ViewModel;
        if (vm == null) return;
        var cur = vm.ImageWidth;
        if (Math.Abs(cur - width) < 0.5) return;
        vm.ImageWidth = width;
    }

    private void ApplyImageWidth(double width)
    {
        if (DisplayImage == null) return;
        var maxW = GetMaxImageDisplayWidth();
        if (width > 0)
            DisplayImage.Width = Math.Min(width, maxW);
        else
            DisplayImage.Width = double.NaN;
    }

}
