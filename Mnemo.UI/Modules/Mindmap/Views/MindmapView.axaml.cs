using System.Linq;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Microsoft.Extensions.DependencyInjection;
using Mnemo.Core.Services;
using Mnemo.UI.Modules.Mindmap.ViewModels;

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
    private bool _isPanning;
    private MindmapNodeItem? _draggingNode;
    private Point _lastScreenPoint;
    private Point _pressScreenPoint;
    private Point _dragGrabOffset;
    private bool _dragMoved;

    public MindmapView()
    {
        InitializeComponent();
        _host = this.FindControl<Border>("CanvasHost");
        if (_host is not null)
        {
            _host.PointerWheelChanged += OnWheel;
            _host.PointerPressed += OnPointerPressed;
            _host.PointerMoved += OnPointerMoved;
            _host.PointerReleased += OnPointerReleased;
            _host.DoubleTapped += OnDoubleTapped;
        }
    }

    private MindmapViewModel? Vm => DataContext as MindmapViewModel;

    private void OnBackClick(object? sender, RoutedEventArgs e)
    {
        var navigation = (Application.Current as App)?.Services?.GetService<INavigationService>();
        navigation?.NavigateTo("mindmap");
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

        var screen = e.GetPosition(_host);
        _pressScreenPoint = screen;
        _lastScreenPoint = screen;
        _dragMoved = false;

        var content = Vm.ScreenToContent(screen);
        var node = HitTest(content);
        if (node is not null)
        {
            Vm.Select(node);
            _draggingNode = node;
            _dragGrabOffset = new Point(content.X - node.X, content.Y - node.Y);
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
        }
    }

    private async void OnPointerReleased(object? sender, PointerReleasedEventArgs e)
    {
        e.Pointer.Capture(null);
        var node = _draggingNode;
        var moved = _dragMoved;
        _draggingNode = null;
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

    private MindmapNodeItem? HitTest(Point content)
    {
        // Topmost-last: iterate in reverse so later (visually upper) nodes win.
        for (var i = Vm!.Nodes.Count - 1; i >= 0; i--)
        {
            var n = Vm.Nodes[i];
            if (content.X >= n.X && content.X <= n.X + n.Width &&
                content.Y >= n.Y && content.Y <= n.Y + n.Height)
                return n;
        }
        return null;
    }
}
