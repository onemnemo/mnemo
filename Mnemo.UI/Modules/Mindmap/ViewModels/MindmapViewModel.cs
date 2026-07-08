using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Globalization;
using System.Linq;
using System.Threading.Tasks;
using System.Windows.Input;
using Avalonia;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Mnemo.Core.Models.Mindmap;
using Mnemo.Core.Services;
using Mnemo.UI.Modules.Mindmap.Services;
using Mnemo.UI.ViewModels;

namespace Mnemo.UI.Modules.Mindmap.ViewModels;

/// <summary>
/// Editor view model for a single schema v2 mindmap (route <c>mindmap-detail</c>). Loads the document,
/// projects its node elements + hierarchy edges into bindable canvas items, and drives structural edits
/// through the one command layer (<see cref="IMindmapService.ApplyAsync"/>) so every gesture is an atomic,
/// revisioned op batch.
/// </summary>
/// <remarks>
/// P2: rendering is a straightforward canvas projection (virtualized custom-draw + quadtree is the tracked
/// next step). Undo/redo is command-based: each edit records the touched-subset delta that reverses
/// and replays it. Clipboard (copy/paste/duplicate-selection) is still stubbed.
/// </remarks>
public partial class MindmapViewModel : ViewModelBase, INavigationAware
{
    private readonly IMindmapService _service;
    private readonly INavigationService _navigation;
    private readonly ILoggerService _logger;
    private readonly ILocalizationService? _localization;

    private readonly MindmapCamera _camera = new();
    private MindmapDocument? _document;

    // Command-based history: each edit records the delta that reverses it and the one that replays
    // it, both scoped to the touched sub-document, so memory is proportional to the change, not the map.
    private readonly Stack<HistoryEntry> _undoStack = new();
    private readonly Stack<HistoryEntry> _redoStack = new();

    private sealed record HistoryEntry(MindmapRestoreDelta Undo, MindmapRestoreDelta Redo);

    [ObservableProperty]
    private string _mapId = string.Empty;

    [ObservableProperty]
    private string _title = string.Empty;

    [ObservableProperty]
    private long _revision;

    [ObservableProperty]
    private bool _isLoading;

    [ObservableProperty]
    private bool _isEditingEnabled = true;

    [ObservableProperty]
    private Matrix _canvasTransform = Matrix.Identity;

    [ObservableProperty]
    private string _zoomLabel = "100%";

    [ObservableProperty]
    private MindmapNodeItem? _selectedNode;

    /// <summary>Edge selection is not yet wired in the foundation slice; kept for the keybind contract.</summary>
    public object? SelectedEdge { get; set; }

    public ObservableCollection<MindmapNodeItem> Nodes { get; } = new();
    public ObservableCollection<MindmapEdgeItem> Edges { get; } = new();

    public ICommand RecenterCommand { get; }
    public ICommand DeleteSelectedCommand { get; }

    public MindmapViewModel(
        IMindmapService service,
        INavigationService navigation,
        ILoggerService logger,
        ILocalizationService? localization = null)
    {
        _service = service;
        _navigation = navigation;
        _logger = logger;
        _localization = localization;

        RecenterCommand = new RelayCommand(Recenter);
        DeleteSelectedCommand = new AsyncRelayCommand(DeleteSelectedAsync, () => SelectedNode is not null);
    }

    public void OnNavigatedTo(object? parameter)
    {
        if (parameter is string id && !string.IsNullOrEmpty(id))
            _ = LoadAsync(id);
    }

    public void OnNavigatedFrom()
    {
        Nodes.Clear();
        foreach (var edge in Edges)
            edge.Dispose();
        Edges.Clear();
    }

    // --- Loading / projection ----------------------------------------------

    private async Task LoadAsync(string id)
    {
        IsLoading = true;
        try
        {
            var result = await _service.GetAsync(id).ConfigureAwait(true);
            if (!result.IsSuccess || result.Value is null)
            {
                _logger.Error("Mindmap", $"Failed to open mindmap '{id}': {result.ErrorMessage}");
                return;
            }

            MapId = id;
            _undoStack.Clear();
            _redoStack.Clear();
            ApplyDocument(result.Value);
            Recenter();
        }
        catch (Exception ex)
        {
            _logger.Error("Mindmap", $"Failed to open mindmap '{id}'.", ex);
        }
        finally
        {
            IsLoading = false;
        }
    }

    private async Task ReloadAsync(string? selectId = null)
    {
        var result = await _service.GetAsync(MapId).ConfigureAwait(true);
        if (result.IsSuccess && result.Value is not null)
        {
            ApplyDocument(result.Value);
            if (selectId is not null)
                Select(Nodes.FirstOrDefault(n => n.Id == selectId));
        }
    }

    private void ApplyDocument(MindmapDocument document)
    {
        _document = document;
        Title = document.Title;
        Revision = document.Revision;

        var positions = MindmapTreeLayout.ComputePositions(document);
        var nodeElements = document.Elements.Where(e => e.Kind == ElementKind.Node).ToList();
        var hasParent = document.Edges
            .Where(e => e.Kind == EdgeKind.Hierarchy)
            .Select(e => e.ToId)
            .ToHashSet();

        var items = new Dictionary<string, MindmapNodeItem>();
        Nodes.Clear();
        foreach (var element in nodeElements)
        {
            var pos = positions.GetValueOrDefault(element.Id);
            var item = new MindmapNodeItem
            {
                Id = element.Id,
                X = pos.X,
                Y = pos.Y,
                Text = NodeText(element.Content),
                IsRoot = !hasParent.Contains(element.Id),
            };
            items[element.Id] = item;
            Nodes.Add(item);
        }

        foreach (var stale in Edges)
            stale.Dispose();
        Edges.Clear();
        foreach (var edge in document.Edges.Where(e => e.Kind == EdgeKind.Hierarchy))
        {
            if (items.TryGetValue(edge.FromId, out var from) && items.TryGetValue(edge.ToId, out var to))
                Edges.Add(new MindmapEdgeItem(edge.Id, from, to));
        }

        SelectedNode = null;
    }

    private static string NodeText(IElementContent content) => content switch
    {
        TextContent t => t.Text,
        TaskContent task => task.Text,
        CodeContent code => code.Source,
        LinkContent link => link.Title ?? link.Url,
        MathContent math => math.Latex,
        _ => string.Empty,
    };

    // --- Selection ---------------------------------------------------------

    public void Select(MindmapNodeItem? node)
    {
        foreach (var n in Nodes)
            n.IsSelected = ReferenceEquals(n, node);
        SelectedNode = node;
        ((AsyncRelayCommand)DeleteSelectedCommand).NotifyCanExecuteChanged();
    }

    public void ClearHoverState()
    {
        // No hover feedback in the foundation slice.
    }

    // --- Camera ------------------------------------------------------------

    public void PanBy(double screenDx, double screenDy)
    {
        _camera.PanByScreenDelta(screenDx, screenDy);
        SyncCamera();
    }

    public void ZoomAt(Point screenAnchor, double factor)
    {
        if (_camera.TryZoomAt(screenAnchor, factor))
            SyncCamera();
    }

    private void Recenter()
    {
        if (Nodes.Count == 0)
            return;
        var cx = Nodes.Average(n => n.CenterX);
        var cy = Nodes.Average(n => n.CenterY);
        _camera.CenterOnContentPoint(new Point(cx, cy), 800, 500);
        SyncCamera();
    }

    private void SyncCamera()
    {
        CanvasTransform = _camera.Transform;
        ZoomLabel = string.Format(CultureInfo.InvariantCulture, "{0:0}%", _camera.Scale * 100);
    }

    public Point ScreenToContent(Point screen) => _camera.ScreenToContent(screen);

    // --- Structural edits (op batches) -------------------------------------

    public async Task AddChildNodeAsync()
    {
        if (SelectedNode is null)
        {
            await AddRootAsync().ConfigureAwait(true);
            return;
        }

        await ApplyAsync(new AddNodesOp
        {
            Under = SelectedNode.Id,
            Nodes = new[] { new MindmapNodeSpec { Ref = "new", Text = T("NewNode") } },
        }, selectRef: "new").ConfigureAwait(true);
    }

    public async Task AddSiblingNodeAsync()
    {
        if (SelectedNode is null || _document is null)
        {
            await AddRootAsync().ConfigureAwait(true);
            return;
        }

        var parentEdge = _document.Edges.FirstOrDefault(e => e.Kind == EdgeKind.Hierarchy && e.ToId == SelectedNode.Id);
        await ApplyAsync(new AddNodesOp
        {
            Under = parentEdge?.FromId,
            After = parentEdge is null ? null : SelectedNode.Id,
            Nodes = new[] { new MindmapNodeSpec { Ref = "new", Text = T("NewNode") } },
        }, selectRef: "new").ConfigureAwait(true);
    }

    public async Task CreateNodeAtAsync(Point contentPoint)
    {
        await ApplyAsync(new AddNodesOp
        {
            Nodes = new[] { new MindmapNodeSpec { Ref = "new", Text = T("NewNode"), X = contentPoint.X, Y = contentPoint.Y } },
        }, selectRef: "new").ConfigureAwait(true);
    }

    private Task AddRootAsync() => ApplyAsync(new AddNodesOp
    {
        Nodes = new[] { new MindmapNodeSpec { Ref = "new", Text = T("NewNode") } },
    }, selectRef: "new");

    public async Task MoveNodeAsync(string nodeId, Point contentPosition)
    {
        await ApplyAsync(new MoveOp { Id = nodeId, X = contentPosition.X, Y = contentPosition.Y }, selectRef: null).ConfigureAwait(true);
    }

    private async Task DeleteSelectedAsync()
    {
        if (SelectedNode is null)
            return;
        await ApplyAsync(new DeleteOp { Ids = new[] { SelectedNode.Id } }, selectRef: null).ConfigureAwait(true);
    }

    private async Task ApplyAsync(MindmapEditOp op, string? selectRef)
    {
        var before = _document;
        try
        {
            var result = await _service.ApplyAsync(MapId, Revision, new[] { op }).ConfigureAwait(true);
            if (!result.IsSuccess || result.Value is null)
            {
                _logger.Error("Mindmap", $"Edit failed on '{MapId}': {result.ErrorMessage}");
                return;
            }
            if (!result.Value.Success)
            {
                _logger.Warning("Mindmap", $"Edit rejected on '{MapId}': {result.Value.Error?.Code} {result.Value.Error?.Message}");
                return;
            }

            var newId = selectRef is not null ? result.Value.CreatedIds.GetValueOrDefault(selectRef) : null;
            await ReloadAsync(newId).ConfigureAwait(true);
            RecordHistory(before, _document);
        }
        catch (Exception ex)
        {
            _logger.Error("Mindmap", $"Edit threw on '{MapId}'.", ex);
        }
    }

    // --- Command-based undo/redo ------------------------------------

    private void RecordHistory(MindmapDocument? before, MindmapDocument? after)
    {
        if (before is null || after is null)
            return;

        var undo = MindmapRestoreDelta.Between(after, before);
        var redo = MindmapRestoreDelta.Between(before, after);
        if (undo.IsEmpty && redo.IsEmpty)
            return;

        _undoStack.Push(new HistoryEntry(undo, redo));
        _redoStack.Clear();
    }

    public async Task UndoAsync()
    {
        if (_undoStack.Count == 0)
            return;
        var entry = _undoStack.Peek();
        if (await RestoreAsync(entry.Undo).ConfigureAwait(true))
        {
            _undoStack.Pop();
            _redoStack.Push(entry);
        }
    }

    public async Task RedoAsync()
    {
        if (_redoStack.Count == 0)
            return;
        var entry = _redoStack.Peek();
        if (await RestoreAsync(entry.Redo).ConfigureAwait(true))
        {
            _redoStack.Pop();
            _undoStack.Push(entry);
        }
    }

    private async Task<bool> RestoreAsync(MindmapRestoreDelta delta)
    {
        if (delta.IsEmpty)
            return true;

        var keepSelected = SelectedNode?.Id;
        try
        {
            var result = await _service.RestoreAsync(MapId, Revision, delta).ConfigureAwait(true);
            if (!result.IsSuccess)
            {
                _logger.Warning("Mindmap", $"Undo/redo restore failed on '{MapId}': {result.ErrorMessage}");
                return false;
            }

            await ReloadAsync(keepSelected).ConfigureAwait(true);
            return true;
        }
        catch (Exception ex)
        {
            _logger.Error("Mindmap", $"Undo/redo restore threw on '{MapId}'.", ex);
            return false;
        }
    }

    // --- Clipboard (subtree copy/paste/duplicate) --------------------------

    private MindmapNodeSpec? _clipboard;

    /// <summary>Captures the selected node and its whole hierarchy subtree as a reusable node spec.</summary>
    public void CopySelection()
    {
        if (SelectedNode is null || _document is null)
            return;
        _clipboard = CaptureSubtree(SelectedNode.Id);
    }

    /// <summary>Pastes the clipboard subtree under the current selection (or as a new root cluster).</summary>
    public async Task PasteAsync()
    {
        if (_clipboard is null)
            return;
        await ApplyAsync(new AddNodesOp
        {
            Under = SelectedNode?.Id,
            Nodes = new[] { _clipboard with { Ref = "paste" } },
        }, selectRef: "paste").ConfigureAwait(true);
    }

    /// <summary>Duplicates the selected subtree as a sibling, or — for a root — as an offset copy beside it.</summary>
    public async Task DuplicateSelectionAsync()
    {
        if (SelectedNode is null || _document is null)
            return;

        var parentEdge = _document.Edges.FirstOrDefault(e => e.Kind == EdgeKind.Hierarchy && e.ToId == SelectedNode.Id);
        if (parentEdge is not null)
        {
            // Non-root: the copy re-homes under the same parent, right after the source (auto-laid).
            var spec = CaptureSubtree(SelectedNode.Id) with { Ref = "dup" };
            await ApplyAsync(new AddNodesOp
            {
                Under = parentEdge.FromId,
                After = SelectedNode.Id,
                Nodes = new[] { spec },
            }, selectRef: "dup").ConfigureAwait(true);
            return;
        }

        // Root: there is no parent to re-home under, and the placeholder layout would drop a fresh root
        // cluster off-screen — so pin the whole copied subtree at a small offset from the source so it
        // lands visibly beside the original.
        const double offset = 48;
        var pinnedSpec = CaptureSubtree(SelectedNode.Id, offset, offset) with { Ref = "dup" };
        await ApplyAsync(new AddNodesOp { Nodes = new[] { pinnedSpec } }, selectRef: "dup").ConfigureAwait(true);
    }

    /// <summary>
    /// Recursively snapshots a node's content and children into a spec (fresh ids assigned on apply). When
    /// an offset is given, each node is pinned at its current on-canvas position plus the offset, so the
    /// copy renders as an exact offset duplicate rather than being re-laid.
    /// </summary>
    private MindmapNodeSpec CaptureSubtree(string nodeId, double offsetX = 0, double offsetY = 0)
    {
        var element = _document!.Elements.First(e => e.Id == nodeId);
        var children = _document.Edges
            .Where(e => e.Kind == EdgeKind.Hierarchy && e.FromId == nodeId)
            .Select(e => CaptureSubtree(e.ToId, offsetX, offsetY))
            .ToList();

        var spec = new MindmapNodeSpec { Content = element.Content, Children = children };
        if (offsetX != 0 || offsetY != 0)
        {
            var item = Nodes.FirstOrDefault(n => n.Id == nodeId);
            if (item is not null)
                spec = spec with { X = item.X + offsetX, Y = item.Y + offsetY };
        }
        return spec;
    }

    public void BeginEditSelectedEdgeLabel()
    {
        // Edge labels are not edited here.
    }

    private string T(string key) => _localization?.T(key, "Mindmap") ?? key;
}
