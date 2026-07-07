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
/// P2 foundation slice: rendering is a straightforward canvas projection (virtualized custom-draw + quadtree
/// is the tracked next step); undo/redo and clipboard are stubbed pending the op-inverse history.
/// </remarks>
public partial class MindmapViewModel : ViewModelBase, INavigationAware
{
    private readonly IMindmapService _service;
    private readonly INavigationService _navigation;
    private readonly ILoggerService _logger;
    private readonly ILocalizationService? _localization;

    private readonly MindmapCamera _camera = new();
    private MindmapDocument? _document;

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

        Edges.Clear();
        foreach (var edge in document.Edges.Where(e => e.Kind == EdgeKind.Hierarchy))
        {
            if (items.TryGetValue(edge.FromId, out var from) && items.TryGetValue(edge.ToId, out var to))
            {
                Edges.Add(new MindmapEdgeItem
                {
                    Id = edge.Id,
                    Start = new Point(from.CenterX, from.CenterY),
                    End = new Point(to.CenterX, to.CenterY),
                });
            }
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
        }
        catch (Exception ex)
        {
            _logger.Error("Mindmap", $"Edit threw on '{MapId}'.", ex);
        }
    }

    // --- Keybind-contract stubs (implemented in the next P2 push) ----------

    public Task UndoAsync()
    {
        _logger.Info("Mindmap", "Undo is not yet implemented (P2 op-inverse history pending).");
        return Task.CompletedTask;
    }

    public Task RedoAsync()
    {
        _logger.Info("Mindmap", "Redo is not yet implemented (P2 op-inverse history pending).");
        return Task.CompletedTask;
    }

    public void CopySelection() =>
        _logger.Info("Mindmap", "Copy is not yet implemented (P2 clipboard pending).");

    public Task PasteAsync()
    {
        _logger.Info("Mindmap", "Paste is not yet implemented (P2 clipboard pending).");
        return Task.CompletedTask;
    }

    public Task DuplicateSelectionAsync()
    {
        _logger.Info("Mindmap", "Duplicate-selection is not yet implemented (P2 clipboard pending).");
        return Task.CompletedTask;
    }

    public void BeginEditSelectedEdgeLabel()
    {
        // Edge labels are not edited here.
    }

    private string T(string key) => _localization?.T(key, "Mindmap") ?? key;
}
