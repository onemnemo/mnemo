using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Globalization;
using System.Linq;
using System.Xml.Linq;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Input;
using Avalonia.Input.Platform;
using Avalonia.Interactivity;
using Avalonia.Layout;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Microsoft.Extensions.DependencyInjection;
using Mnemo.Core.Formatting;
using Mnemo.Core.Services;
using Mnemo.Core.Sketch;
using Mnemo.UI.Components.Overlays;
using Mnemo.UI.Services;

namespace Mnemo.UI.Components.BlockEditor.BlockComponents.Sketch;

public partial class SketchBlockComponent : BlockComponentBase
{
    private readonly SketchCompiler _compiler = new();
    private string _lastGoodSvg = string.Empty;
    private BlockViewModel? _subscribedViewModel;
    private IOverlayService? _overlayService;
    private string? _overlayId;

    private bool _isResizing;
    private double _resizeDragStartX;
    private double _resizeDragStartWidth;
    private double? _resizePendingWidth;
    private bool _resizeMutationCompleted;
    private double _svgNaturalWidth = 320;
    private double _svgNaturalHeight = 160;

    private Point? _reorderPressPoint;
    private PointerPressedEventArgs? _reorderPressArgs;
    private bool _reorderDragLaunched;
    private TopLevel? _gestureTopLevel;
    private EventHandler<PointerReleasedEventArgs>? _gesturePointerReleasedHandler;
    private EventHandler<PointerEventArgs>? _gesturePointerMovedHandler;
    private bool _gestureTopLevelHandlersActive;
    private const double SketchReorderDragThresholdPixels = 6;

    /// <summary>BlockContainer padding + add column + drag column. Content column = list row width minus this.</summary>
    private const double BlockItemContentChromeInset = 76;

    /// <summary>Hard cap so huge monitors do not allow absurd sketch widths.</summary>
    private const double MaxSketchWidthCap = 1600;

    /// <summary>Root padding (12x2) plus diagram frame padding (12x2).</summary>
    private const double SketchPreviewHorizontalChrome = 48;

    private const double MinSketchPreviewWidth = 80;

    private const double MinSketchCardWidth = SketchPreviewHorizontalChrome + MinSketchPreviewWidth;

    public SketchBlockComponent()
    {
        _overlayService = (Application.Current as App)?.Services?.GetService<IOverlayService>();
        InitializeComponent();
        DataContextChanged += OnDataContextChanged;
    }

    public override Control? GetInputControl() => null;

    protected override void OnAttachedToVisualTree(VisualTreeAttachmentEventArgs e)
    {
        base.OnAttachedToVisualTree(e);
        if (HoverHost != null)
            HoverHost.LayoutUpdated += OnHoverHostLayoutUpdated;
        SyncFromViewModel();
        RefreshPreview();
    }

    protected override void OnDetachedFromVisualTree(VisualTreeAttachmentEventArgs e)
    {
        if (HoverHost != null)
            HoverHost.LayoutUpdated -= OnHoverHostLayoutUpdated;
        CompleteResizeMutation();
        EndResizeSession();
        if (_subscribedViewModel != null)
            _subscribedViewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _subscribedViewModel = null;
        DataContextChanged -= OnDataContextChanged;
        UnregisterSketchGestureTopLevelHandlers();
        CloseOverlay();
        base.OnDetachedFromVisualTree(e);
    }

    private void OnHoverHostLayoutUpdated(object? sender, EventArgs e) =>
        ClampWidthToViewport();

    private void OnDataContextChanged(object? sender, EventArgs e)
    {
        if (_subscribedViewModel != null)
            _subscribedViewModel.PropertyChanged -= OnViewModelPropertyChanged;

        _subscribedViewModel = DataContext as BlockViewModel;
        if (_subscribedViewModel != null)
            _subscribedViewModel.PropertyChanged += OnViewModelPropertyChanged;

        SyncFromViewModel();
        RefreshPreview();
    }

    private void OnViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(BlockViewModel.Content))
            RefreshPreview();
    }

    // ── Sync from VM ──────────────────────────────────────────────────────────

    private void SyncFromViewModel()
    {
        var vm = ViewModel;
        if (vm == null) return;

        ApplySketchWidth(vm.SketchWidth);
        ClampWidthToViewport();
        UpdateAlignButtonIcons();
    }

    private void ApplySketchWidth(double width)
    {
        if (RootBorder == null) return;
        var maxW = GetMaxSketchDisplayWidth();
        RootBorder.Width = width > 0 ? Math.Clamp(width, MinSketchCardWidth, maxW) : double.NaN;
        ApplyPreviewViewport();
    }

    // ── Preview ───────────────────────────────────────────────────────────────

    private void RefreshPreview()
    {
        var source = (DataContext as BlockViewModel)?.Content ?? string.Empty;
        var result = _compiler.CompileToSvg(source);
        var errors = result.Diagnostics
            .Where(d => d.Severity == SketchDiagnosticSeverity.Error)
            .ToArray();

        if (errors.Length == 0)
        {
            _lastGoodSvg = result.Svg;
            UpdateSvgNaturalSize(result.Svg);
            Preview.Svg = result.Svg;
            ApplyPreviewViewport();
            DiagnosticsText.IsVisible = false;
            DiagnosticsText.Text = string.Empty;
            return;
        }

        if (!string.IsNullOrWhiteSpace(_lastGoodSvg))
            Preview.Svg = _lastGoodSvg;
        DiagnosticsText.Text = string.Join("\n", errors.Select(d => d.Message));
        DiagnosticsText.IsVisible = true;
    }

    // ── Hover host ────────────────────────────────────────────────────────────

    private void HoverHost_PointerEntered(object? sender, PointerEventArgs e)
    {
        ShowToolbar();
        UpdateResizeChromeVisibility();
    }

    private void HoverHost_PointerExited(object? sender, PointerEventArgs e)
    {
        // Never collapse during resize; any layout change disrupts the drag delta.
        if (_isResizing) return;

        if (FlyoutButton?.Flyout?.IsOpen == true)
            return;
        if (AlignMenuButton?.Flyout is { IsOpen: true })
            return;

        HideToolbar();
        UpdateResizeChromeVisibility();
    }

    private void ShowToolbar()
    {
        Toolbar.Opacity = 1;
        Toolbar.IsHitTestVisible = true;
    }

    private void HideToolbar()
    {
        Toolbar.Opacity = 0;
        Toolbar.IsHitTestVisible = false;
    }

    private void HoverHost_KeyDown(object? sender, KeyEventArgs e)
    {
        if (e.Handled) return;
        if ((e.KeyModifiers & (KeyModifiers.Control | KeyModifiers.Alt | KeyModifiers.Meta)) != 0)
            return;

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

    // ── Open editor overlay (diagram chrome click; release without drag) ─────

    private void SketchChrome_PointerPressed(object? sender, PointerPressedEventArgs e)
    {
        if (!e.GetCurrentPoint(this).Properties.IsLeftButtonPressed)
            return;
        if (SketchChrome == null || !IsPointerWithinSketchChrome(e))
            return;

        HoverHost?.Focus();

        // Defer opening the overlay until release; if the pointer moves beyond the threshold
        // first, we initiate a block reorder drag instead.
        _reorderDragLaunched = false;
        _reorderPressPoint = e.GetPosition(SketchChrome);
        _reorderPressArgs = e;
        e.Pointer.Capture(SketchChrome);
        RegisterSketchGestureTopLevelHandlers();
    }

    private void SketchChrome_PointerMoved(object? sender, PointerEventArgs e) =>
        TryAdvanceSketchReorderDrag(e);

    private void SketchChrome_PointerReleased(object? sender, PointerReleasedEventArgs e) =>
        CompleteSketchClickGesture(e);

    private void SketchChrome_PointerCaptureLost(object? sender, PointerCaptureLostEventArgs e)
    {
        // Releasing capture to start DoDragDrop fires this; TopLevel release still completes a click.
        if (_reorderDragLaunched)
            return;
    }

    private bool IsPointerWithinSketchChrome(PointerEventArgs e)
    {
        if (SketchChrome == null || e.Source is not Visual src)
            return false;
        if (ReferenceEquals(src, SketchChrome))
            return true;
        return src.GetVisualAncestors().Any(a => ReferenceEquals(a, SketchChrome));
    }

    private void RegisterSketchGestureTopLevelHandlers()
    {
        if (_gestureTopLevelHandlersActive)
            return;

        _gestureTopLevel ??= TopLevel.GetTopLevel(this);
        if (_gestureTopLevel == null)
            return;

        _gesturePointerReleasedHandler ??= OnSketchGestureTopLevelPointerReleased;
        _gesturePointerMovedHandler ??= OnSketchGestureTopLevelPointerMoved;
        _gestureTopLevel.AddHandler(PointerReleasedEvent, _gesturePointerReleasedHandler, RoutingStrategies.Tunnel);
        _gestureTopLevel.AddHandler(PointerMovedEvent, _gesturePointerMovedHandler, RoutingStrategies.Tunnel);
        _gestureTopLevelHandlersActive = true;
    }

    private void UnregisterSketchGestureTopLevelHandlers()
    {
        if (!_gestureTopLevelHandlersActive || _gestureTopLevel == null)
            return;

        if (_gesturePointerReleasedHandler != null)
            _gestureTopLevel.RemoveHandler(PointerReleasedEvent, _gesturePointerReleasedHandler);
        if (_gesturePointerMovedHandler != null)
            _gestureTopLevel.RemoveHandler(PointerMovedEvent, _gesturePointerMovedHandler);
        _gestureTopLevelHandlersActive = false;
    }

    private void OnSketchGestureTopLevelPointerMoved(object? sender, PointerEventArgs e) =>
        TryAdvanceSketchReorderDrag(e);

    private void OnSketchGestureTopLevelPointerReleased(object? sender, PointerReleasedEventArgs e) =>
        CompleteSketchClickGesture(e);

    private void TryAdvanceSketchReorderDrag(PointerEventArgs e)
    {
        if (!_reorderPressPoint.HasValue || _reorderDragLaunched || SketchChrome == null)
            return;
        if (!e.GetCurrentPoint(this).Properties.IsLeftButtonPressed)
            return;

        var p = e.GetPosition(SketchChrome);
        var origin = _reorderPressPoint.Value;
        var dist = Math.Sqrt((p.X - origin.X) * (p.X - origin.X) + (p.Y - origin.Y) * (p.Y - origin.Y));
        if (dist < SketchReorderDragThresholdPixels)
            return;

        _reorderDragLaunched = true;
        _ = RunSketchReorderDragAsync();
    }

    private void CompleteSketchClickGesture(PointerReleasedEventArgs e)
    {
        if (!_reorderPressPoint.HasValue)
            return;
        if (e.InitialPressMouseButton != MouseButton.Left)
            return;

        if (SketchChrome != null && ReferenceEquals(e.Pointer.Captured, SketchChrome))
            e.Pointer.Capture(null);

        if (!_reorderDragLaunched)
            OpenEditorOverlay();

        ClearSketchReorderGestureState();
    }

    private void ClearSketchReorderGestureState()
    {
        _reorderPressPoint = null;
        _reorderPressArgs = null;
        _reorderDragLaunched = false;
        UnregisterSketchGestureTopLevelHandlers();
    }

    private async Task RunSketchReorderDragAsync()
    {
        try
        {
            if (_reorderPressArgs == null)
                return;

            if (ReferenceEquals(_reorderPressArgs.Pointer.Captured, SketchChrome))
                _reorderPressArgs.Pointer.Capture(null);

            var eb = this.GetVisualAncestors().OfType<EditableBlock>().FirstOrDefault();
            if (eb != null)
                await eb.BeginBlockReorderDragCoreAsync(_reorderPressArgs).ConfigureAwait(true);
        }
        finally
        {
            ClearSketchReorderGestureState();
        }
    }

    private void OpenEditorOverlay()
    {
        var vm = ViewModel ?? _subscribedViewModel;
        if (vm == null)
            return;

        _overlayService ??= (Application.Current as App)?.Services?.GetService<IOverlayService>();
        if (_overlayService == null)
            return;

        CloseOverlay();

        var overlay = new SketchEditorOverlay
        {
            Source = vm.Content ?? string.Empty
        };
        overlay.SaveRequested += SaveOverlaySource;
        overlay.CancelRequested += CloseOverlay;

        _overlayId = _overlayService.CreateOverlay(
            overlay,
            new OverlayOptions
            {
                ShowBackdrop = true,
                CloseOnOutsideClick = false,
                CloseOnEscape = true,
                HorizontalAlignment = HorizontalAlignment.Stretch,
                VerticalAlignment = VerticalAlignment.Stretch
            },
            "SketchEditor");
    }

    private void SaveOverlaySource(string source)
    {
        if (_subscribedViewModel == null)
            return;

        _subscribedViewModel.NotifyStructuralChangeStarting();
        _subscribedViewModel.Content = source;
        _subscribedViewModel.NotifyStructuralChangeCompleted("Update Sketch diagram");
        RefreshPreview();
        CloseOverlay();
    }

    private void CloseOverlay()
    {
        if (string.IsNullOrEmpty(_overlayId) || _overlayService == null)
            return;

        _overlayService.CloseOverlay(_overlayId);
        _overlayId = null;
    }

    // ── Alignment ─────────────────────────────────────────────────────────────

    private static string NormalizeAlign(string? value) =>
        value?.Trim().ToLowerInvariant() switch
        {
            "center" => "center",
            "right" => "right",
            _ => "left",
        };

    private string GetSketchAlign() => NormalizeAlign(ViewModel?.SketchAlign);

    private void UpdateAlignButtonIcons()
    {
        var align = GetSketchAlign();
        var path = align switch
        {
            "center" => "avares://Mnemo.UI/Icons/Editor/align-center.svg",
            "right" => "avares://Mnemo.UI/Icons/Editor/align-right.svg",
            _ => "avares://Mnemo.UI/Icons/Editor/align-left.svg",
        };
        if (AlignButtonIcon != null)
            AlignButtonIcon.SvgPath = path;
    }

    private void SetSketchAlign(string value)
    {
        var vm = ViewModel;
        if (vm == null) return;
        var normalized = NormalizeAlign(value);
        if (string.Equals(vm.SketchAlign, normalized, StringComparison.Ordinal))
            return;
        vm.NotifyStructuralChangeStarting();
        vm.SketchAlign = normalized;
        vm.NotifyStructuralChangeCompleted("Change sketch alignment");
        UpdateAlignButtonIcons();
    }

    private void AlignPickLeft_Click(object? sender, RoutedEventArgs e)
    {
        SetSketchAlign("left");
        HideAlignFlyout();
    }

    private void AlignPickCenter_Click(object? sender, RoutedEventArgs e)
    {
        SetSketchAlign("center");
        HideAlignFlyout();
    }

    private void AlignPickRight_Click(object? sender, RoutedEventArgs e)
    {
        SetSketchAlign("right");
        HideAlignFlyout();
    }

    private void HideAlignFlyout()
    {
        Dispatcher.UIThread.Post(() =>
        {
            if (AlignMenuButton?.Flyout is FlyoutBase f && f.IsOpen)
                f.Hide();
        }, DispatcherPriority.Background);
    }

    // ── Flyout (copy, duplicate, delete) ─────────────────────────────────────

    private async void FlyoutCopy_Click(object? sender, RoutedEventArgs e)
    {
        var vm = ViewModel;
        if (vm == null) return;

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
            await noteSvc.WriteAsync(topLevel.Clipboard, markdown, json, null).ConfigureAwait(true);
            return;
        }

        await topLevel.Clipboard.SetTextAsync(vm.Content ?? string.Empty).ConfigureAwait(true);
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

    // ── Resize handle ─────────────────────────────────────────────────────────

    private void UpdateResizeChromeVisibility()
    {
        if (ResizeHitBorder == null) return;
        ResizeHitBorder.IsVisible = _isResizing || (HoverHost?.IsPointerOver == true);
    }

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

        var maxW = GetMaxSketchDisplayWidth();
        var currentWidth = RootBorder.Width;
        var raw = !double.IsNaN(currentWidth) && currentWidth > 0
            ? currentWidth
            : (RootBorder.Bounds.Width > 0 ? RootBorder.Bounds.Width : 320);
        _resizeDragStartWidth = Math.Clamp(raw, MinSketchCardWidth, maxW);
        ViewModel?.NotifyStructuralChangeStarting();

        if (sender is InputElement element)
        {
            element.Cursor = new Cursor(StandardCursorType.SizeWestEast);
            e.Pointer.Capture(element);
        }
        e.Handled = true;
    }

    private void ResizeHitArea_PointerMoved(object? sender, PointerEventArgs e)
    {
        if (!_isResizing) return;

        var delta = e.GetPosition(this).X - _resizeDragStartX;
        var maxW = GetMaxSketchDisplayWidth();
        var newWidth = Math.Clamp(_resizeDragStartWidth + delta, MinSketchCardWidth, maxW);

        RootBorder.Width = newWidth;
        ApplyPreviewViewport(newWidth);
        _resizePendingWidth = newWidth;
    }

    private void ResizeHitArea_PointerReleased(object? sender, PointerReleasedEventArgs e)
    {
        if (!_isResizing) return;

        CompleteResizeMutation();
        e.Pointer.Capture(null);
        EndResizeSession();
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
        // Sync toolbar visibility with actual hover state now that resize is done.
        if (HoverHost?.IsPointerOver != true)
            HideToolbar();
    }

    private void CompleteResizeMutation()
    {
        if (_resizeMutationCompleted) return;

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
            if (Math.Abs(vm.SketchWidth - pending) > 0.25)
                vm.SketchWidth = pending;
        }

        _resizePendingWidth = null;
        vm.NotifyStructuralChangeCompleted("Resize sketch");
        _resizeMutationCompleted = true;
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private double GetContentColumnConstraintWidth()
    {
        for (Visual? p = this.GetVisualParent(); p != null; p = p.GetVisualParent())
        {
            if (p is EditableBlock eb && eb.GetVisualParent() is Control slot && slot.Bounds.Width > 0)
                return Math.Max(0, slot.Bounds.Width - BlockItemContentChromeInset);

            if (p is Control c && string.Equals(c.Name, "BlocksItemsControl", StringComparison.Ordinal)
                && c.Bounds.Width > 0)
                return Math.Max(0, c.Bounds.Width - BlockItemContentChromeInset);

            if (p is BlockEditor be && be.Bounds.Width > 0)
            {
                const double editorHorizontalPadding = 64;
                return Math.Max(0, be.Bounds.Width - editorHorizontalPadding - BlockItemContentChromeInset);
            }
        }
        return 0;
    }

    private double GetMaxSketchDisplayWidth()
    {
        double colW = GetContentColumnConstraintWidth();
        return colW > 0
            ? Math.Clamp(colW, MinSketchCardWidth, MaxSketchWidthCap)
            : MaxSketchWidthCap;
    }

    private void ClampWidthToViewport()
    {
        if (RootBorder == null) return;

        var maxW = GetMaxSketchDisplayWidth();
        var w = RootBorder.Width;

        if (double.IsNaN(w) || w <= 0)
        {
            var rendered = RootBorder.Bounds.Width;
            if (rendered > maxW)
            {
                RootBorder.Width = maxW;
                ApplyPreviewViewport(maxW);
                PersistClampedWidth(maxW);
            }
            else
            {
                ApplyPreviewViewport(rendered);
            }
            return;
        }

        if (w > maxW)
        {
            RootBorder.Width = maxW;
            ApplyPreviewViewport(maxW);
            PersistClampedWidth(maxW);
            return;
        }

        if (w < MinSketchCardWidth)
        {
            RootBorder.Width = MinSketchCardWidth;
            ApplyPreviewViewport(MinSketchCardWidth);
            PersistClampedWidth(MinSketchCardWidth);
            return;
        }

        ApplyPreviewViewport(w);
    }

    private void ApplyPreviewViewport(double cardWidth = 0)
    {
        if (Preview == null)
            return;

        var width = cardWidth > 0
            ? cardWidth
            : !double.IsNaN(RootBorder.Width) && RootBorder.Width > 0
                ? RootBorder.Width
                : RootBorder.Bounds.Width;
        if (width <= 0)
            return;

        var previewWidth = Math.Max(MinSketchPreviewWidth, width - SketchPreviewHorizontalChrome);
        var aspect = _svgNaturalHeight > 0 && _svgNaturalWidth > 0
            ? _svgNaturalHeight / _svgNaturalWidth
            : 0.5;

        Preview.Width = previewWidth;
        Preview.Height = Math.Max(1, previewWidth * aspect);
    }

    private void UpdateSvgNaturalSize(string svg)
    {
        try
        {
            var root = XDocument.Parse(svg).Root;
            if (root == null)
                return;

            var width = ReadSvgDouble(root, "width", _svgNaturalWidth);
            var height = ReadSvgDouble(root, "height", _svgNaturalHeight);
            if (width <= 0 || height <= 0)
                return;

            _svgNaturalWidth = width;
            _svgNaturalHeight = height;
        }
        catch
        {
            _svgNaturalWidth = 320;
            _svgNaturalHeight = 160;
        }
    }

    private static double ReadSvgDouble(XElement element, string attributeName, double fallback)
    {
        var raw = element.Attribute(attributeName)?.Value;
        if (string.IsNullOrWhiteSpace(raw))
            return fallback;

        raw = raw.Trim().TrimEnd('%');
        return double.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out var value)
            ? value
            : fallback;
    }

    private void PersistClampedWidth(double width)
    {
        var vm = ViewModel;
        if (vm == null) return;
        if (Math.Abs(vm.SketchWidth - width) < 0.5) return;
        vm.SketchWidth = width;
    }

}
