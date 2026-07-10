using System;
using System.Linq;
using System.Threading.Tasks;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Media;
using Avalonia.Platform.Storage;
using Avalonia.Threading;
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
    private TextBox? _labelEditor;
    private MindmapViewModel? _subscribedVm;
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

    // Multi-selection drag: every other selected element (plus non-primary selected frames' members), shifted
    // live by the primary's delta, then committed as one move batch. Null for a plain single-element drag.
    private System.Collections.Generic.List<(MindmapNodeItem Item, double OrigX, double OrigY)>? _multiDragMembers;
    private Point _multiDragOrigin;

    // True while the pressed element was already part of a 2+ selection, so a release without a drag collapses
    // the selection to just that element (standard click-through behaviour on a group).
    private bool _pressedMultiMember;

    // Shift+drag marquee on empty canvas: its start point (content coords) while in progress.
    private bool _isMarqueeing;
    private Point _marqueeStartContent;

    // Connect tool: while engaged (VM.IsConnectToolActive), a press-drag from one element to another
    // creates a link edge. The rubber-band source is view-local.
    private MindmapNodeItem? _connectSource;

    // Resizing a selected free element/frame by its bottom-right handle.
    private const double MinElementSize = 40;
    private MindmapNodeItem? _resizingNode;

    public MindmapView()
    {
        InitializeComponent();
        _host = this.FindControl<Border>("CanvasHost");
        _canvas = this.FindControl<MindmapCanvasControl>("World");
        _labelEditor = this.FindControl<TextBox>("LabelEditor");

        // The canvas renders math nodes through the shared LaTeX engine; wire it once from the app container.
        if (_canvas is not null)
            _canvas.LatexEngine = (Application.Current as App)?.Services?.GetService<ILaTeXEngine>();
        if (_host is not null)
        {
            _host.PointerWheelChanged += OnWheel;
            _host.PointerPressed += OnPointerPressed;
            _host.PointerMoved += OnPointerMoved;
            _host.PointerReleased += OnPointerReleased;
            _host.PointerExited += OnHostPointerExited;
            _host.DoubleTapped += OnDoubleTapped;
            _host.SizeChanged += OnHostSizeChanged;
        }

        if (_labelEditor is not null)
        {
            _labelEditor.KeyDown += OnLabelEditorKeyDown;
            _labelEditor.LostFocus += OnLabelEditorLostFocus;
        }

        DataContextChanged += OnDataContextChanged;

        // The workspace keybind host skips the mindmap-detail route in the tunnel phase so a focused label
        // editor can consume Tab/Enter first; canvas shortcuts are matched here in the bubble phase instead.
        AddHandler(KeyDownEvent, OnKeyDown, RoutingStrategies.Bubble);
        Loaded += (_, _) =>
        {
            _canvas?.Focus();
            if (_host is not null)
                Vm?.UpdateViewportSize(_host.Bounds.Size);
        };
    }

    // The view mirrors pointer/size changes into the view model so cursor-anchored actions (radial toolkit, tool
    // shortcuts) can place elements where the cursor is, falling back to the viewport center when it's off-canvas.
    private void OnHostPointerExited(object? sender, PointerEventArgs e) => Vm?.SetPointerOverCanvas(false);

    private void OnHostSizeChanged(object? sender, SizeChangedEventArgs e) => Vm?.UpdateViewportSize(e.NewSize);

    private MindmapViewModel? Vm => DataContext as MindmapViewModel;

    // Follow the active view model so the code-behind can focus the editor when the VM opens it, and react
    // to the connect-tool toggle (clear the rubber-band, flip the button icon color).
    private void OnDataContextChanged(object? sender, EventArgs e)
    {
        if (_subscribedVm is not null)
        {
            _subscribedVm.LabelEditorOpened -= OnLabelEditorOpened;
            _subscribedVm.PropertyChanged -= OnVmPropertyChanged;
        }
        _subscribedVm = Vm;
        if (_subscribedVm is not null)
        {
            _subscribedVm.LabelEditorOpened += OnLabelEditorOpened;
            _subscribedVm.PropertyChanged += OnVmPropertyChanged;
        }
        SyncConnectToolVisual();
    }

    private void OnVmPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(MindmapViewModel.IsConnectToolActive))
            SyncConnectToolVisual();
    }

    // Reflects the VM's connect-tool state in the pill icon and clears any in-progress rubber-band.
    private void SyncConnectToolVisual()
    {
        var on = Vm?.IsConnectToolActive == true;
        _connectSource = null;
        _canvas?.SetPendingLink(null, default);
        if (ConnectIcon is not null)
            ConnectIcon.Color = TryResource(on ? "AccentButtonForegroundBrush" : "TextSecondaryBrush");
    }

    // The TextBox is only just made visible; defer the focus so it can take it, then select all for type-to-rename.
    private void OnLabelEditorOpened() => Dispatcher.UIThread.Post(() =>
    {
        if (_labelEditor is null || Vm?.IsLabelEditorVisible != true)
            return;
        _labelEditor.Focus();
        _labelEditor.SelectAll();
    }, DispatcherPriority.Background);

    private void OnLabelEditorKeyDown(object? sender, KeyEventArgs e)
    {
        if (Vm is null)
            return;

        // Escape always cancels; marked handled so the canvas bubble handler doesn't also fire.
        if (e.Key == Key.Escape)
        {
            e.Handled = true;
            Vm.CancelLabelEdit();
            _canvas?.Focus();
            return;
        }

        // Multi-line (code) editing: plain Enter inserts a newline and Ctrl+Enter commits. Single-line labels
        // commit on Enter. When we don't commit, the keystroke falls through to the TextBox unhandled.
        if (e.Key is Key.Enter or Key.Return)
        {
            var commit = !Vm.LabelEditorAcceptsReturn || e.KeyModifiers.HasFlag(KeyModifiers.Control);
            if (!commit)
                return;

            e.Handled = true;
            _ = Vm.CommitLabelEditAsync();
            _canvas?.Focus();
        }
    }

    // Clicking away (or focusing the canvas) commits the pending edit.
    private void OnLabelEditorLostFocus(object? sender, RoutedEventArgs e)
    {
        if (Vm is { IsLabelEditorVisible: true })
            _ = Vm.CommitLabelEditAsync();
    }

    private void OnBackClick(object? sender, RoutedEventArgs e)
    {
        var navigation = (Application.Current as App)?.Services?.GetService<INavigationService>();
        navigation?.NavigateTo("mindmap");
    }

    private void OnKeyDown(object? sender, KeyEventArgs e)
    {
        if (e.Handled)
            return;

        // A focused text field (the inline label editor, the inspector hex boxes) owns its keystrokes; canvas
        // shortcuts like Delete/Tab/Enter must not fire while typing.
        if (e.Source is TextBox)
            return;

        // Escape closes the radial toolkit before anything else consumes it.
        if (Vm?.IsRadialOpen == true && e.Key == Key.Escape)
        {
            Vm.CloseRadial();
            e.Handled = true;
            return;
        }

        // Escape leaves the connect tool rather than falling through to a global keybind.
        if (Vm?.IsConnectToolActive == true && e.Key == Key.Escape)
        {
            Vm.ToggleConnectTool();
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
        _pressedMultiMember = false;

        var content = Vm.ScreenToContent(screen);
        var node = HitTest(content);

        // Connect tool: start a link from the pressed element; empty space is a no-op (stays in the tool).
        if (Vm.IsConnectToolActive)
        {
            if (node is not null)
            {
                _connectSource = node;
                _canvas?.SetPendingLink(new Point(node.CenterX, node.CenterY), content);
                e.Pointer.Capture(_host);
            }
            return;
        }

        var additive = e.KeyModifiers.HasFlag(KeyModifiers.Control) || e.KeyModifiers.HasFlag(KeyModifiers.Shift);

        // Ctrl/Shift+click on an element toggles its set membership (no drag, no chrome interaction).
        if (additive && node is not null)
        {
            Vm.ToggleSelect(node);
            e.Pointer.Capture(_host);
            return;
        }

        // Chrome (badges, checkboxes, ref glyphs, resize handles) that the canvas simplifies away at low zoom
        // must not respond to clicks either — the affordance isn't drawn, so a click there falls through to
        // plain selection/drag/pan instead.
        var chromeInteractive = _canvas?.ChromeVisible ?? true;

        // The resize handle sits on the selected element's bottom-right corner, partly outside its rect, so
        // the node hit-test would miss it. Check it directly against the current selection, before anything else.
        if (chromeInteractive && Vm.SelectedNode is { IsFree: true } selected && IsInResizeHandle(content, selected))
        {
            _resizingNode = selected;
            e.Pointer.Capture(_host);
            return;
        }

        if (node is not null)
        {
            // A plain press on an element already in a 2+ selection keeps the whole set for a group drag;
            // otherwise it becomes the single selection. Chrome affordances (pin/task/ref) stay single-only.
            var partOfMulti = node.IsSelected && Vm.SelectedNodes.Count > 1;
            if (partOfMulti)
            {
                _pressedMultiMember = true;
            }
            else
            {
                Vm.Select(node);

                // Clicking a pinned node's badge releases it back into auto-layout (no drag).
                if (chromeInteractive && IsInPinBadge(content, node))
                {
                    _ = Vm.SetPinnedAsync(node.Id, false);
                    return;
                }

                // Clicking a task node's checkbox toggles its done state (no drag).
                if (chromeInteractive && IsInTaskCheckbox(content, node))
                {
                    _ = Vm.ToggleTaskDoneAsync(node.Id);
                    return;
                }

                // Clicking a reference node's kind glyph follows it (open link / open note or deck), no drag.
                if (chromeInteractive && IsInRefGlyph(content, node))
                {
                    _ = Vm.OpenRefAsync(node.Id);
                    return;
                }
            }

            _draggingNode = node;
            _dragGrabOffset = new Point(content.X - node.X, content.Y - node.Y);
            CaptureFrameMembers(node);
            if (partOfMulti)
                CaptureMultiDragMembers(node);
        }
        else if (HitTestEdge(content, screen) is { } edge)
        {
            // A click near a link edge selects it (no drag/pan) so its floating toolbar appears.
            Vm.SelectEdge(edge);
        }
        else if (e.KeyModifiers.HasFlag(KeyModifiers.Shift))
        {
            // Shift+drag on empty canvas draws a marquee; the selection is applied on release.
            _isMarqueeing = true;
            _marqueeStartContent = content;
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
        Vm.UpdatePointer(screen, new Rect(_host.Bounds.Size).Contains(screen));

        // Connect tool: track the rubber-band line to the cursor while dragging from the source.
        if (_connectSource is not null)
        {
            _canvas?.SetPendingLink(new Point(_connectSource.CenterX, _connectSource.CenterY), Vm.ScreenToContent(screen));
            return;
        }

        // Resizing: the bottom-right corner follows the cursor, clamped to a minimum size.
        if (_resizingNode is not null)
        {
            var content = Vm.ScreenToContent(screen);
            _resizingNode.Width = System.Math.Max(MinElementSize, content.X - _resizingNode.X);
            _resizingNode.Height = System.Math.Max(MinElementSize, content.Y - _resizingNode.Y);
            return;
        }

        if (System.Math.Abs(screen.X - _pressScreenPoint.X) > DragThreshold ||
            System.Math.Abs(screen.Y - _pressScreenPoint.Y) > DragThreshold)
            _dragMoved = true;

        // Marquee: grow the selection rectangle from the press point to the cursor.
        if (_isMarqueeing)
        {
            var content = Vm.ScreenToContent(screen);
            _canvas?.SetMarquee(RectFromPoints(_marqueeStartContent, content));
            return;
        }

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

            if (_multiDragMembers is not null)
            {
                var dx = _draggingNode.X - _multiDragOrigin.X;
                var dy = _draggingNode.Y - _multiDragOrigin.Y;
                foreach (var (item, origX, origY) in _multiDragMembers)
                {
                    item.X = origX + dx;
                    item.Y = origY + dy;
                }
            }
        }
    }

    // A content-space rectangle from two corner points (marquee bounds).
    private static Rect RectFromPoints(Point a, Point b) =>
        new(System.Math.Min(a.X, b.X), System.Math.Min(a.Y, b.Y),
            System.Math.Abs(a.X - b.X), System.Math.Abs(a.Y - b.Y));

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

    // Snapshot the rest of a multi-selection so the whole group shifts live with the dragged element. Every
    // other selected element moves by the same delta, plus the members of any selected frame (so a framed
    // group follows its frame), deduped so a member that is itself selected only moves once. The dragged
    // element's own frame members are excluded — CaptureFrameMembers already shifts those, so shifting them
    // here too would double them.
    private void CaptureMultiDragMembers(MindmapNodeItem dragged)
    {
        _multiDragMembers = null;
        if (Vm is null || Vm.SelectedNodes.Count <= 1)
            return;

        _multiDragOrigin = new Point(dragged.X, dragged.Y);

        var alreadyShifted = new System.Collections.Generic.HashSet<string>();
        if (dragged.Kind == ElementKind.Frame)
            foreach (var id in dragged.MemberIds)
                alreadyShifted.Add(id);

        var toShift = new System.Collections.Generic.Dictionary<string, MindmapNodeItem>();
        foreach (var n in Vm.SelectedNodes)
            if (!ReferenceEquals(n, dragged) && !alreadyShifted.Contains(n.Id))
                toShift[n.Id] = n;

        foreach (var frame in Vm.SelectedNodes)
            if (frame.Kind == ElementKind.Frame && !ReferenceEquals(frame, dragged))
                foreach (var memberId in frame.MemberIds)
                {
                    if (alreadyShifted.Contains(memberId))
                        continue;
                    var item = Vm.Nodes.FirstOrDefault(x => x.Id == memberId);
                    if (item is not null && !ReferenceEquals(item, dragged))
                        toShift[memberId] = item;
                }

        _multiDragMembers = toShift.Values.Select(n => (n, n.X, n.Y)).ToList();
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

        // Resizing: commit the element's new size.
        if (_resizingNode is not null)
        {
            var resized = _resizingNode;
            _resizingNode = null;
            if (Vm is not null)
                await Vm.ResizeElementAsync(resized.Id, resized.Width, resized.Height);
            return;
        }

        // Marquee: select everything intersecting the rectangle (or clear on a shift-click that didn't drag).
        if (_isMarqueeing)
        {
            _isMarqueeing = false;
            _canvas?.SetMarquee(null);
            if (Vm is not null && _host is not null && _dragMoved && _canvas is not null)
            {
                var end = Vm.ScreenToContent(e.GetPosition(_host));
                var hits = _canvas.HitTestNodes(RectFromPoints(_marqueeStartContent, end));
                Vm.SelectMany(hits);
            }
            else
            {
                Vm?.Select(null);
            }
            return;
        }

        var node = _draggingNode;
        var moved = _dragMoved;
        var multiDrag = _multiDragMembers is not null;
        var pressedMultiMember = _pressedMultiMember;
        _draggingNode = null;
        _dragMembers = null;
        _multiDragMembers = null;
        _pressedMultiMember = false;
        _isPanning = false;

        if (Vm is null || node is null)
            return;

        if (moved)
        {
            if (multiDrag)
            {
                // Group drag: one move batch for the whole set (frame membership isn't touched for multi-drags).
                await Vm.CommitMultiMoveAsync();
            }
            else
            {
                await Vm.MoveNodeAsync(node.Id, new Point(node.X, node.Y));

                // Dropping a non-frame element inside a frame joins it (or leaving one removes it).
                if (node.Kind != ElementKind.Frame)
                    await Vm.UpdateFrameMembershipAsync(node.Id);
            }
        }
        else if (pressedMultiMember)
        {
            // A plain click on a group member without dragging collapses the selection to just that element.
            Vm.Select(node);
        }
    }

    private async void OnDoubleTapped(object? sender, TappedEventArgs e)
    {
        if (Vm is null || _host is null)
            return;
        var content = Vm.ScreenToContent(e.GetPosition(_host));
        var hit = HitTest(content);
        if (hit is null)
        {
            // Empty canvas: create a node (the view model opens the editor on it to name it).
            await Vm.CreateNodeAtAsync(content);
            return;
        }

        Vm.Select(hit);

        // A reference node opens its target on double-click rather than editing (note/flashcard have no editable
        // label anyway; a link's title is still editable via the F2/Enter keybind path).
        if (IsRefNode(hit))
        {
            await Vm.OpenRefAsync(hit.Id);
            return;
        }

        // Existing element (any kind, including a frame's title/interior): edit its label.
        Vm.BeginEditElement(hit);
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

    private async void OnAddImageClick(object? sender, RoutedEventArgs e)
    {
        if (Vm is not null)
            await CreateImageAtAsync(ViewportCenterContent());
    }

    // Shared by the bottom pill and the radial toolkit: pick an image file and place it at the given content point.
    private async Task CreateImageAtAsync(Point content)
    {
        if (Vm is null)
            return;

        var topLevel = TopLevel.GetTopLevel(this);
        if (topLevel is null)
            return;

        var files = await topLevel.StorageProvider.OpenFilePickerAsync(new FilePickerOpenOptions
        {
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
            return;

        var sourcePath = files[0].TryGetLocalPath();
        if (string.IsNullOrEmpty(sourcePath))
            return;

        await Vm.CreateImageAsync(sourcePath, content);
    }

    private void OnConnectClick(object? sender, RoutedEventArgs e) => Vm?.ToggleConnectTool();

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

    // --- Radial toolkit: the same six tools, placed at the content point under the ring's cursor origin ---
    // Close the ring before creating so a freshly opened label editor isn't hidden behind the backdrop.

    private async void OnRadialNodeClick(object? sender, RoutedEventArgs e)
    {
        if (Vm is null)
            return;
        var content = Vm.RadialContentPoint();
        Vm.CloseRadial();
        await Vm.CreateNodeAtAsync(content);
    }

    private async void OnRadialTextClick(object? sender, RoutedEventArgs e)
    {
        if (Vm is null)
            return;
        var content = Vm.RadialContentPoint();
        Vm.CloseRadial();
        await Vm.CreateFreeTextAsync(content);
    }

    private async void OnRadialFrameClick(object? sender, RoutedEventArgs e)
    {
        if (Vm is null)
            return;
        var content = Vm.RadialContentPoint();
        Vm.CloseRadial();
        await Vm.CreateFrameAsync(content);
    }

    private void OnRadialConnectClick(object? sender, RoutedEventArgs e)
    {
        if (Vm is null)
            return;
        Vm.CloseRadial();
        Vm.ToggleConnectTool();
    }

    private async void OnRadialImageClick(object? sender, RoutedEventArgs e)
    {
        if (Vm is null)
            return;
        var content = Vm.RadialContentPoint();
        Vm.CloseRadial();
        await CreateImageAtAsync(content);
    }

    // The radial's shape wedge opens the same tile picker as the pill; a tile creates that shape at the ring origin.
    private async void OnRadialShapeClick(object? sender, RoutedEventArgs e)
    {
        if (Vm is null || sender is not Control { Tag: string name } || !Enum.TryParse<ShapeType>(name, out var shape))
            return;
        RadialShapeButton.Flyout?.Hide();
        var content = Vm.RadialContentPoint();
        Vm.CloseRadial();
        await Vm.CreateShapeAsync(shape, content);
    }

    // A press anywhere outside the ring dismisses it (and is swallowed so it doesn't reach the canvas beneath).
    private void OnRadialBackdropPressed(object? sender, PointerPressedEventArgs e)
    {
        Vm?.CloseRadial();
        e.Handled = true;
    }

    // Hit-testing goes through the canvas control's quadtree (topmost node under the point).
    private MindmapNodeItem? HitTest(Point content) => _canvas?.HitTestNode(content);

    // Link-edge hit-testing: a fixed screen-pixel grab radius converted to content units so it stays
    // clickable at any zoom.
    private const double EdgeHitScreenRadius = 8;

    private MindmapEdgeItem? HitTestEdge(Point content, Point screen)
    {
        if (Vm is null || _canvas is null)
            return null;
        var offset = Vm.ScreenToContent(new Point(screen.X + EdgeHitScreenRadius, screen.Y));
        var threshold = System.Math.Abs(offset.X - content.X);
        return _canvas.HitTestEdge(content, threshold);
    }

    private static bool IsInResizeHandle(Point content, MindmapNodeItem node)
    {
        if (!node.IsFree)
            return false;

        var half = MindmapNodeItem.ResizeHandleSize / 2 + MindmapNodeItem.ResizeHandleHitPad;
        var cx = node.X + node.Width;
        var cy = node.Y + node.Height;
        return content.X >= cx - half && content.X <= cx + half
            && content.Y >= cy - half && content.Y <= cy + half;
    }

    private static bool IsInTaskCheckbox(Point content, MindmapNodeItem node)
    {
        if (node.ContentType != ElementContentDiscriminators.Task)
            return false;

        const double pad = 4; // generous grab area around the box
        var size = MindmapNodeItem.TaskCheckboxSize;
        var x = node.X + MindmapNodeItem.TaskCheckboxInset;
        var y = node.Y + (node.Height - size) / 2;
        return content.X >= x - pad && content.X <= x + size + pad
            && content.Y >= y - pad && content.Y <= y + size + pad;
    }

    private static bool IsRefNode(MindmapNodeItem node) =>
        node.ContentType is ElementContentDiscriminators.Link
            or ElementContentDiscriminators.Note
            or ElementContentDiscriminators.Flashcard;

    private static bool IsInRefGlyph(Point content, MindmapNodeItem node)
    {
        if (!IsRefNode(node))
            return false;

        const double pad = 4; // generous grab area around the glyph
        var size = MindmapNodeItem.RefGlyphSize;
        var x = node.X + MindmapNodeItem.RefGlyphInset;
        var y = node.Y + (node.Height - size) / 2;
        return content.X >= x - pad && content.X <= x + size + pad
            && content.Y >= y - pad && content.Y <= y + size + pad;
    }

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
