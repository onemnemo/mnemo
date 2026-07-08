using System;
using System.Linq;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Media;
using Microsoft.Extensions.DependencyInjection;
using Mnemo.Core.Models.Keybinds;
using Mnemo.Core.Models.Mindmap;
using Mnemo.Core.Services;
using Mnemo.UI.Modules.Mindmap.ViewModels;
using Mnemo.UI.Services;

namespace Mnemo.UI.Modules.Mindmap.Views;

/// <summary>
/// Editor canvas host (route <c>mindmap-detail</c>). Handles camera pan/zoom, node selection, drag-move
/// and click-to-create; structural edits flow to the view model's op-batch commands. Keyboard structure
/// editing (Tab/Enter/Delete) arrives via the global mindmap keybind dispatch.
/// </summary>
public partial class MindmapView : UserControl
{
    private const double ZoomStep = 1.1;
    private const double DragThreshold = 4;

    private Border? _host;
    private MindmapCanvasControl? _canvas;
    private bool _isPanning;
    private MindmapNodeItem? _draggingNode;
    private Point _lastScreenPoint;
    private Point _pressScreenPoint;
    private Point _dragGrabOffset;
    private bool _dragMoved;

    // When dragging a frame, its members move with it: their positions at grab time, shifted live by the
    // frame's delta. The service commits the same translation on release (see MindmapDocumentService).
    private System.Collections.Generic.List<(MindmapNodeItem Item, double OrigX, double OrigY)>? _dragMembers;
    private Point _dragFrameOrigin;

    // Connect tool: while engaged, a press-drag from one element to another creates a link edge.
    private bool _connectMode;
    private MindmapNodeItem? _connectSource;

    public MindmapView()
    {
        InitializeComponent();
        _host = this.FindControl<Border>("CanvasHost");
        _canvas = this.FindControl<MindmapCanvasControl>("World");
        if (_host is not null)
        {
            _host.PointerWheelChanged += OnWheel;
            _host.PointerPressed += OnPointerPressed;
            _host.PointerMoved += OnPointerMoved;
            _host.PointerReleased += OnPointerReleased;
            _host.DoubleTapped += OnDoubleTapped;
        }

        // The workspace keybind host skips the mindmap-detail route in the tunnel phase so a focused label
        // editor can consume Tab/Enter first; canvas shortcuts are matched here in the bubble phase instead.
        AddHandler(KeyDownEvent, OnKeyDown, RoutingStrategies.Bubble);
        Loaded += (_, _) => _canvas?.Focus();
    }

    private MindmapViewModel? Vm => DataContext as MindmapViewModel;

    private void OnBackClick(object? sender, RoutedEventArgs e)
    {
        var navigation = (Application.Current as App)?.Services?.GetService<INavigationService>();
        navigation?.NavigateTo("mindmap");
    }

    private void OnKeyDown(object? sender, KeyEventArgs e)
    {
        if (e.Handled)
            return;

        // Escape leaves the connect tool rather than falling through to a global keybind.
        if (_connectMode && e.Key == Key.Escape)
        {
            SetConnectMode(false);
            e.Handled = true;
            return;
        }

        if (Application.Current is not App app || app.Services is null)
            return;

        var keyMap = app.Services.GetService<IKeyMap>();
        var router = app.Services.GetService<IKeybindActionRouter>();
        if (keyMap is null || router is null)
            return;

        var input = KeybindInputNormalizer.FromKeyEvent(e);
        var result = keyMap.ProcessLocalKeyDown(input, DateTime.UtcNow, SequenceSwallowMode.SwallowOnPrefixAdvance);
        if (result.CompletedAction && !string.IsNullOrEmpty(result.ActionId) && !router.TryExecute(result.ActionId))
            return;
        if (result.Handled)
            e.Handled = true;
    }

    private void OnWheel(object? sender, PointerWheelEventArgs e)
    {
        if (Vm is null || _host is null)
            return;
        var factor = e.Delta.Y > 0 ? ZoomStep : 1 / ZoomStep;
        Vm.ZoomAt(e.GetPosition(_host), factor);
        e.Handled = true;
    }

    private void OnPointerPressed(object? sender, PointerPressedEventArgs e)
    {
        if (Vm is null || _host is null || !e.GetCurrentPoint(_host).Properties.IsLeftButtonPressed)
            return;

        // Take keyboard focus so canvas keybinds (Tab/Enter/Delete/undo/…) route to this view.
        _canvas?.Focus();

        var screen = e.GetPosition(_host);
        _pressScreenPoint = screen;
        _lastScreenPoint = screen;
        _dragMoved = false;

        var content = Vm.ScreenToContent(screen);
        var node = HitTest(content);

        // Connect tool: start a link from the pressed element; empty space is a no-op (stays in the tool).
        if (_connectMode)
        {
            if (node is not null)
            {
                _connectSource = node;
                _canvas?.SetPendingLink(new Point(node.CenterX, node.CenterY), content);
                e.Pointer.Capture(_host);
            }
            return;
        }

        if (node is not null)
        {
            Vm.Select(node);

            // Clicking a pinned node's badge releases it back into auto-layout (no drag).
            if (IsInPinBadge(content, node))
            {
                _ = Vm.SetPinnedAsync(node.Id, false);
                return;
            }

            _draggingNode = node;
            _dragGrabOffset = new Point(content.X - node.X, content.Y - node.Y);
            CaptureFrameMembers(node);
        }
        else
        {
            Vm.Select(null);
            _isPanning = true;
        }

        e.Pointer.Capture(_host);
    }

    private void OnPointerMoved(object? sender, PointerEventArgs e)
    {
        if (Vm is null || _host is null)
            return;

        var screen = e.GetPosition(_host);
        var delta = screen - _lastScreenPoint;
        _lastScreenPoint = screen;

        // Connect tool: track the rubber-band line to the cursor while dragging from the source.
        if (_connectSource is not null)
        {
            _canvas?.SetPendingLink(new Point(_connectSource.CenterX, _connectSource.CenterY), Vm.ScreenToContent(screen));
            return;
        }

        if (System.Math.Abs(screen.X - _pressScreenPoint.X) > DragThreshold ||
            System.Math.Abs(screen.Y - _pressScreenPoint.Y) > DragThreshold)
            _dragMoved = true;

        if (_isPanning)
        {
            Vm.PanBy(delta.X, delta.Y);
        }
        else if (_draggingNode is not null)
        {
            var content = Vm.ScreenToContent(screen);
            _draggingNode.X = content.X - _dragGrabOffset.X;
            _draggingNode.Y = content.Y - _dragGrabOffset.Y;

            if (_dragMembers is not null)
            {
                var dx = _draggingNode.X - _dragFrameOrigin.X;
                var dy = _draggingNode.Y - _dragFrameOrigin.Y;
                foreach (var (item, origX, origY) in _dragMembers)
                {
                    item.X = origX + dx;
                    item.Y = origY + dy;
                }
            }
        }
    }

    // Snapshot a dragged frame's members so they can be shifted with it during the drag.
    private void CaptureFrameMembers(MindmapNodeItem node)
    {
        _dragMembers = null;
        if (node.Kind != ElementKind.Frame || node.MemberIds.Count == 0 || Vm is null)
            return;

        var memberIds = new System.Collections.Generic.HashSet<string>(node.MemberIds);
        _dragFrameOrigin = new Point(node.X, node.Y);
        _dragMembers = Vm.Nodes
            .Where(n => memberIds.Contains(n.Id))
            .Select(n => (n, n.X, n.Y))
            .ToList();
    }

    private async void OnPointerReleased(object? sender, PointerReleasedEventArgs e)
    {
        e.Pointer.Capture(null);

        // Connect tool: releasing over a different element creates the link; over empty/self it just cancels.
        if (_connectSource is not null)
        {
            var source = _connectSource;
            _connectSource = null;
            _canvas?.SetPendingLink(null, default);
            if (Vm is not null && _host is not null)
            {
                var target = HitTest(Vm.ScreenToContent(e.GetPosition(_host)));
                if (target is not null && !ReferenceEquals(target, source))
                    await Vm.LinkAsync(source.Id, target.Id);
            }
            return;
        }

        var node = _draggingNode;
        var moved = _dragMoved;
        _draggingNode = null;
        _dragMembers = null;
        _isPanning = false;

        if (Vm is not null && node is not null && moved)
            await Vm.MoveNodeAsync(node.Id, new Point(node.X, node.Y));
    }

    private async void OnDoubleTapped(object? sender, TappedEventArgs e)
    {
        if (Vm is null || _host is null)
            return;
        var content = Vm.ScreenToContent(e.GetPosition(_host));
        if (HitTest(content) is null)
            await Vm.CreateNodeAtAsync(content);
    }

    // --- Bottom tool pill: place free elements at the current viewport center ---

    private async void OnAddNodeClick(object? sender, RoutedEventArgs e)
    {
        if (Vm is not null)
            await Vm.CreateNodeAtAsync(ViewportCenterContent());
    }

    private async void OnAddTextClick(object? sender, RoutedEventArgs e)
    {
        if (Vm is not null)
            await Vm.CreateFreeTextAsync(ViewportCenterContent());
    }

    private async void OnAddFrameClick(object? sender, RoutedEventArgs e)
    {
        if (Vm is not null)
            await Vm.CreateFrameAsync(ViewportCenterContent());
    }

    private void OnConnectClick(object? sender, RoutedEventArgs e) => SetConnectMode(!_connectMode);

    // Toggles the connect tool, updating the button's active state and cancelling any pending link.
    private void SetConnectMode(bool on)
    {
        _connectMode = on;
        _connectSource = null;
        _canvas?.SetPendingLink(null, default);

        if (ConnectButton is not null)
            ConnectButton.Classes.Set("active", on);
        if (ConnectIcon is not null)
            ConnectIcon.Color = TryResource(on ? "AccentButtonForegroundBrush" : "TextSecondaryBrush");
    }

    private IBrush? TryResource(string key) => this.TryFindResource(key, out var value) ? value as IBrush : null;

    private async void OnShapeClick(object? sender, RoutedEventArgs e)
    {
        if (Vm is null || sender is not Control { Tag: string name } || !Enum.TryParse<ShapeType>(name, out var shape))
            return;
        ShapeButton.Flyout?.Hide();
        await Vm.CreateShapeAsync(shape, ViewportCenterContent());
    }

    private Point ViewportCenterContent()
    {
        var size = _host?.Bounds.Size ?? new Size(800, 500);
        return Vm!.ScreenToContent(new Point(size.Width / 2, size.Height / 2));
    }

    // Hit-testing goes through the canvas control's quadtree (topmost node under the point).
    private MindmapNodeItem? HitTest(Point content) => _canvas?.HitTestNode(content);

    private static bool IsInPinBadge(Point content, MindmapNodeItem node)
    {
        if (!node.IsPinned)
            return false;
        var cx = node.X + node.Width - MindmapNodeItem.PinBadgeInset;
        var cy = node.Y + MindmapNodeItem.PinBadgeInset;
        var dx = content.X - cx;
        var dy = content.Y - cy;
        return dx * dx + dy * dy <= MindmapNodeItem.PinBadgeHitRadius * MindmapNodeItem.PinBadgeHitRadius;
    }
}
