using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Globalization;
using System.Linq;
using System.Threading.Tasks;
using System.Windows.Input;
using Avalonia;
using Avalonia.Media;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Mnemo.Core.Models.Mindmap;
using Mnemo.Core.Services;
using Mnemo.UI.Modules.Mindmap.Services;
using Mnemo.UI.Modules.Mindmap.Views;
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
    private readonly IMindmapLayoutService _layout;
    private readonly IMindmapStyleResolver _styleResolver;
    private readonly IMindmapStyleTemplateProvider _templates;
    private readonly INavigationService _navigation;
    private readonly ILoggerService _logger;
    private readonly ILocalizationService? _localization;
    private readonly IOverlayService? _overlay;

    private readonly MindmapCamera _camera = new();
    private MindmapDocument? _document;

    // Each node's cluster root id, from the last projection, so the inspector can target the right tree.
    private IReadOnlyDictionary<string, string> _clusterRootByNode = new Dictionary<string, string>();

    // Guards against a slow layout pass applying after a newer document has already arrived.
    private int _applyGeneration;

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
    [NotifyPropertyChangedFor(nameof(HasSelection))]
    [NotifyPropertyChangedFor(nameof(IsNodeSelected))]
    private MindmapNodeItem? _selectedNode;

    /// <summary>True when any element is selected; drives the inspector's content vs its empty state.</summary>
    public bool HasSelection => SelectedNode is not null;

    /// <summary>True only for a tree node (not a free shape/text); gates node-only inspector controls.</summary>
    public bool IsNodeSelected => SelectedNode is { IsFree: false };

    /// <summary>Whether the docked style inspector panel is open (toggled from the top bar).</summary>
    [ObservableProperty]
    private bool _isInspectorOpen;

    // Hex entries in the inspector's color sections; prefilled from the selected node's custom colors.
    [ObservableProperty]
    private string _fillHex = string.Empty;

    [ObservableProperty]
    private string _strokeHex = string.Empty;

    [ObservableProperty]
    private string _textHex = string.Empty;

    /// <summary>Whether the floating style toolbar shows (a node is selected).</summary>
    [ObservableProperty]
    private bool _isSelectionToolbarVisible;

    [ObservableProperty]
    private double _selectionToolbarLeft;

    [ObservableProperty]
    private double _selectionToolbarTop;

    /// <summary>The selected link edge, if any; drives the floating edge toolbar. Mutually exclusive with a node selection.</summary>
    [ObservableProperty]
    private MindmapEdgeItem? _selectedEdge;

    /// <summary>Whether the floating edge toolbar shows (a link edge is selected).</summary>
    [ObservableProperty]
    private bool _isEdgeToolbarVisible;

    [ObservableProperty]
    private double _edgeToolbarLeft;

    [ObservableProperty]
    private double _edgeToolbarTop;

    /// <summary>The map's layout algorithm, bound to the top-bar switcher. Applies to every cluster.</summary>
    [ObservableProperty]
    private MindmapLayoutOption? _selectedLayoutOption;

    /// <summary>The map's style template, bound to the top-bar picker. Sets the document default template.</summary>
    [ObservableProperty]
    private MindmapTemplateOption? _selectedTemplateOption;

    /// <summary>The selected node's cluster template, bound to the inspector. Sets that tree's template only.</summary>
    [ObservableProperty]
    private MindmapTemplateOption? _selectedClusterTemplateOption;

    // True while a selection is set programmatically (on load/reload), so it doesn't re-issue an op.
    private bool _suppressLayoutOptionChange;
    private bool _suppressTemplateOptionChange;
    private bool _suppressClusterTemplateChange;

    public ObservableCollection<MindmapNodeItem> Nodes { get; } = new();
    public ObservableCollection<MindmapEdgeItem> Edges { get; } = new();
    public ObservableCollection<MindmapLayoutOption> LayoutOptions { get; } = new();
    public ObservableCollection<MindmapTemplateOption> TemplateOptions { get; } = new();

    public ICommand RecenterCommand { get; }
    public ICommand DeleteSelectedCommand { get; }

    public MindmapViewModel(
        IMindmapService service,
        IMindmapLayoutService layout,
        IMindmapStyleResolver styleResolver,
        IMindmapStyleTemplateProvider templates,
        INavigationService navigation,
        ILoggerService logger,
        ILocalizationService? localization = null,
        IOverlayService? overlay = null)
    {
        _service = service;
        _layout = layout;
        _styleResolver = styleResolver;
        _templates = templates;
        _navigation = navigation;
        _logger = logger;
        _localization = localization;
        _overlay = overlay;

        RecenterCommand = new RelayCommand(Recenter);
        DeleteSelectedCommand = new AsyncRelayCommand(DeleteSelectedAsync, () => SelectedNode is not null);

        BuildLayoutOptions();
        BuildTemplateOptions();
    }

    // --- Layout switcher ---------------------------------------------------

    private void BuildLayoutOptions()
    {
        LayoutOptions.Clear();
        LayoutOptions.Add(new MindmapLayoutOption(MindmapLayoutAlgorithms.Balanced, LayoutLabel("LayoutBalanced", "Balanced")));
        LayoutOptions.Add(new MindmapLayoutOption(MindmapLayoutAlgorithms.TreeRight, LayoutLabel("LayoutTreeRight", "Tree · right")));
        LayoutOptions.Add(new MindmapLayoutOption(MindmapLayoutAlgorithms.TreeDown, LayoutLabel("LayoutTreeDown", "Tree · down")));
        LayoutOptions.Add(new MindmapLayoutOption(MindmapLayoutAlgorithms.Radial, LayoutLabel("LayoutRadial", "Radial")));
        LayoutOptions.Add(new MindmapLayoutOption(MindmapLayoutAlgorithms.Timeline, LayoutLabel("LayoutTimeline", "Timeline")));
        LayoutOptions.Add(new MindmapLayoutOption(MindmapLayoutAlgorithms.Free, LayoutLabel("LayoutFree", "Free")));
    }

    private string LayoutLabel(string key, string fallback) => Tr(key, fallback);

    /// <summary>Localized string with a fallback, defaulting to the Mindmap namespace.</summary>
    private string Tr(string key, string fallback, string ns = "Mindmap")
    {
        var value = _localization?.T(key, ns);
        return string.IsNullOrEmpty(value) || value == key ? fallback : value;
    }

    partial void OnSelectedLayoutOptionChanged(MindmapLayoutOption? value)
    {
        if (_suppressLayoutOptionChange || value is null || _document is null)
            return;
        _ = ChangeLayoutAsync(value.Id);
    }

    /// <summary>Sets every cluster's layout algorithm (one <see cref="LayoutOp"/> per root) and re-lays out.</summary>
    private async Task ChangeLayoutAsync(string algorithm)
    {
        if (_document is null)
            return;
        var roots = RootIds(_document);
        if (roots.Count == 0)
            return;

        var ops = roots.Select(id => (MindmapEditOp)new LayoutOp { Root = id, Algorithm = algorithm }).ToList();
        await ApplyOpsAsync(ops, selectRef: null).ConfigureAwait(true);
    }

    private static List<string> RootIds(MindmapDocument document)
    {
        var nodeIds = document.Elements.Where(e => e.Kind == ElementKind.Node).Select(e => e.Id).ToHashSet();
        var hasParent = document.Edges
            .Where(e => e.Kind == EdgeKind.Hierarchy && nodeIds.Contains(e.ToId))
            .Select(e => e.ToId)
            .ToHashSet();
        return nodeIds.Where(id => !hasParent.Contains(id)).ToList();
    }

    private void SyncLayoutSelection(MindmapDocument document)
    {
        var algorithm = document.Clusters.FirstOrDefault()?.LayoutAlgorithm ?? MindmapLayoutAlgorithms.Balanced;
        _suppressLayoutOptionChange = true;
        SelectedLayoutOption = LayoutOptions.FirstOrDefault(o => o.Id == algorithm) ?? LayoutOptions.FirstOrDefault();
        _suppressLayoutOptionChange = false;
    }

    // --- Template picker ---------------------------------------------------

    private void BuildTemplateOptions()
    {
        TemplateOptions.Clear();
        foreach (var template in _templates.BuiltIns)
            TemplateOptions.Add(new MindmapTemplateOption(template.Id, template.Name));
        foreach (var template in _templates.UserTemplates)
            TemplateOptions.Add(new MindmapTemplateOption(template.Id, template.Name, IsUser: true));
    }

    /// <summary>Reloads user templates from storage and rebuilds the picker.</summary>
    private async Task RefreshTemplatesAsync()
    {
        try
        {
            await _templates.RefreshAsync().ConfigureAwait(true);
        }
        catch (Exception ex)
        {
            _logger.Error("Mindmap", "Failed to load user style templates.", ex);
        }

        RebuildTemplatePicker();
    }

    // Rebuilds the picker from the provider's current templates, keeping the document and cluster selections.
    private void RebuildTemplatePicker()
    {
        BuildTemplateOptions();
        if (_document is not null)
        {
            SyncTemplateSelection(_document);
            SyncClusterTemplateSelection();
        }
    }

    partial void OnSelectedTemplateOptionChanged(MindmapTemplateOption? value)
    {
        if (_suppressTemplateOptionChange || value is null || _document is null)
            return;
        _ = ChangeTemplateAsync(value.Id);
    }

    /// <summary>Sets the document's default style template and re-projects.</summary>
    private async Task ChangeTemplateAsync(string templateId)
    {
        if (_document is null)
            return;
        await ApplyOpsAsync(new[] { (MindmapEditOp)new LayoutOp { TemplateId = templateId } }, selectRef: null).ConfigureAwait(true);
    }

    private void SyncTemplateSelection(MindmapDocument document)
    {
        var id = document.Canvas.DefaultTemplateId ?? _templates.Default.Id;
        _suppressTemplateOptionChange = true;
        SelectedTemplateOption = TemplateOptions.FirstOrDefault(o => o.Id == id) ?? TemplateOptions.FirstOrDefault();
        _suppressTemplateOptionChange = false;
    }

    partial void OnSelectedClusterTemplateOptionChanged(MindmapTemplateOption? value)
    {
        if (_suppressClusterTemplateChange || value is null || _document is null || SelectedNode is null)
            return;
        _ = SetClusterTemplateAsync(value.Id);
    }

    /// <summary>Sets the selected node's cluster (tree) template, layering above the document default.</summary>
    private Task SetClusterTemplateAsync(string templateId)
    {
        // Only tree nodes belong to a cluster; free elements have no template of their own.
        if (SelectedNode is null || SelectedNode.IsFree)
            return Task.CompletedTask;
        return ApplyToSelectionAsync(new LayoutOp { Root = ClusterRootOf(SelectedNode.Id), TemplateId = templateId });
    }

    // Points the inspector's template picker at the selected node's tree: its explicit cluster template if it
    // has one, otherwise the document default it currently inherits.
    private void SyncClusterTemplateSelection()
    {
        if (SelectedNode is null || _document is null)
            return;
        var rootId = ClusterRootOf(SelectedNode.Id);
        var clusterTemplate = _document.Clusters.FirstOrDefault(c => c.RootId == rootId)?.TemplateId;
        var id = clusterTemplate ?? _document.Canvas.DefaultTemplateId ?? _templates.Default.Id;
        _suppressClusterTemplateChange = true;
        SelectedClusterTemplateOption = TemplateOptions.FirstOrDefault(o => o.Id == id) ?? TemplateOptions.FirstOrDefault();
        _suppressClusterTemplateChange = false;
    }

    private string ClusterRootOf(string nodeId) =>
        _clusterRootByNode.TryGetValue(nodeId, out var root) ? root : nodeId;

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
            await RefreshTemplatesAsync().ConfigureAwait(true);
            await ApplyDocumentAsync(result.Value).ConfigureAwait(true);
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
            await ApplyDocumentAsync(result.Value).ConfigureAwait(true);
            if (selectId is not null)
                Select(Nodes.FirstOrDefault(n => n.Id == selectId));
        }
    }

    /// <summary>
    /// Projects a document onto the canvas: runs the layout engine per cluster, then rebuilds the
    /// bindable node/edge items. A generation guard drops a pass whose positions arrive after a newer
    /// document has already been applied (the snapshot-revision discard rule).
    /// </summary>
    private async Task ApplyDocumentAsync(MindmapDocument document)
    {
        var generation = ++_applyGeneration;
        var positions = await ComputeLayoutAsync(document).ConfigureAwait(true);
        if (generation != _applyGeneration)
            return;

        _document = document;
        Title = document.Title;
        Revision = document.Revision;
        SyncLayoutSelection(document);
        SyncTemplateSelection(document);

        var hasParent = document.Edges
            .Where(e => e.Kind == EdgeKind.Hierarchy)
            .Select(e => e.ToId)
            .ToHashSet();

        // Style cascade: each node's depth/branch context, plus the per-cluster template chain.
        var styleContexts = BuildStyleContexts(document);
        _clusterRootByNode = styleContexts.ToDictionary(kv => kv.Key, kv => kv.Value.RootId);
        var documentTemplate = _templates.ById(document.Canvas.DefaultTemplateId) ?? _templates.Default;
        var clusterTemplateIds = document.Clusters.ToDictionary(c => c.RootId, c => c.TemplateId);
        var chainCache = new Dictionary<string, IReadOnlyList<StyleTemplate>>();

        IReadOnlyList<StyleTemplate> ChainFor(string rootId)
        {
            if (chainCache.TryGetValue(rootId, out var cached))
                return cached;
            var clusterTemplate = _templates.ById(clusterTemplateIds.GetValueOrDefault(rootId));
            IReadOnlyList<StyleTemplate> chain = clusterTemplate is not null && clusterTemplate.Id != documentTemplate.Id
                ? new[] { clusterTemplate, documentTemplate }
                : new[] { documentTemplate };
            chainCache[rootId] = chain;
            return chain;
        }

        var items = new Dictionary<string, MindmapNodeItem>();
        var branchColors = new Dictionary<string, string?>();
        Nodes.Clear();

        // Frames are containers, so they draw behind everything — project them first (lowest z). Their
        // explicit membership rides along so the canvas can drag the whole group together.
        foreach (var element in document.Elements.Where(e => e.Kind == ElementKind.Frame))
        {
            var style = _styleResolver.Resolve(element.Style, StyleContext.Free, System.Array.Empty<StyleTemplate>());
            var item = new MindmapNodeItem
            {
                Id = element.Id,
                Kind = ElementKind.Frame,
                MemberIds = (element.Content as FrameContent)?.ChildIds ?? System.Array.Empty<string>(),
                X = element.X,
                Y = element.Y,
                Width = element.Width ?? MindmapNodeItem.FrameDefaultWidth,
                Height = element.Height ?? MindmapNodeItem.FrameDefaultHeight,
                Text = NodeText(element.Content),
                HasStyleOverride = element.Style is not null,
                FillToken = style.Fill,
                StrokeToken = style.Stroke,
                TextToken = style.TextColor,
                FontScale = style.FontScale,
            };
            items[element.Id] = item;
            Nodes.Add(item);
        }

        foreach (var element in document.Elements.Where(e => e.Kind == ElementKind.Node))
        {
            // No computed position = hidden under a collapsed ancestor; skip it (and its edges).
            if (!positions.TryGetValue(element.Id, out var pos))
                continue;

            var context = styleContexts.TryGetValue(element.Id, out var info) ? info.Context : StyleContext.Free;
            var rootId = info.RootId ?? element.Id;
            var style = _styleResolver.Resolve(element.Style, context, ChainFor(rootId));
            branchColors[element.Id] = style.BranchColor;

            var item = new MindmapNodeItem
            {
                Id = element.Id,
                X = pos.X,
                Y = pos.Y,
                Width = element.Width ?? MindmapNodeItem.DefaultWidth,
                Height = element.Height ?? MindmapNodeItem.DefaultHeight,
                Text = NodeText(element.Content),
                IsRoot = !hasParent.Contains(element.Id),
                IsPinned = element.Pinned,
                IsCollapsed = element.Collapsed,
                HasStyleOverride = element.Style is not null,
                FillToken = style.Fill,
                StrokeToken = style.Stroke,
                TextToken = style.TextColor,
                Shape = style.NodeShape,
                FontScale = style.FontScale,
            };
            items[element.Id] = item;
            Nodes.Add(item);
        }

        // Free elements (shapes, text) sit at their stored positions outside the tree and auto-layout; the
        // cascade's template rules don't apply to them (StyleContext.Free), only their own overrides.
        foreach (var element in document.Elements.Where(e => e.Kind is ElementKind.Shape or ElementKind.Text))
        {
            var style = _styleResolver.Resolve(element.Style, StyleContext.Free, System.Array.Empty<StyleTemplate>());
            var item = new MindmapNodeItem
            {
                Id = element.Id,
                Kind = element.Kind,
                FreeShape = (element.Content as ShapeContent)?.Shape,
                X = element.X,
                Y = element.Y,
                Width = element.Width ?? DefaultFreeWidth(element.Kind),
                Height = element.Height ?? DefaultFreeHeight(element.Kind),
                Text = NodeText(element.Content),
                HasStyleOverride = element.Style is not null,
                FillToken = style.Fill,
                StrokeToken = style.Stroke,
                TextToken = style.TextColor,
                FontScale = style.FontScale,
            };
            items[element.Id] = item;
            Nodes.Add(item);
        }

        foreach (var stale in Edges)
            stale.Dispose();
        Edges.Clear();
        foreach (var edge in document.Edges.Where(e => e.Kind == EdgeKind.Hierarchy))
        {
            // A branch-colored template gives each child a palette token; its incoming edge takes the same.
            if (items.TryGetValue(edge.FromId, out var from) && items.TryGetValue(edge.ToId, out var to))
                Edges.Add(new MindmapEdgeItem(edge.Id, from, to, colorToken: branchColors.GetValueOrDefault(edge.ToId)));
        }

        // Link edges join any two elements (whiteboard connectors). They default to a solid straight line
        // with an arrow at the target so they read as connectors, honoring any per-edge style overrides.
        foreach (var edge in document.Edges.Where(e => e.Kind == EdgeKind.Link))
        {
            if (!items.TryGetValue(edge.FromId, out var from) || !items.TryGetValue(edge.ToId, out var to))
                continue;
            Edges.Add(new MindmapEdgeItem(
                edge.Id, from, to,
                isHierarchy: false,
                colorToken: edge.Style?.Color,
                startCap: edge.Style?.StartCap ?? ArrowCap.None,
                endCap: edge.Style?.EndCap ?? ArrowCap.Arrow,
                lineStyle: edge.Style?.Line ?? LineStyle.Solid,
                label: edge.Label));
        }

        // The old node/edge items are gone; drop selection so no toolbar points at a stale, disposed item.
        SelectedNode = null;
        SelectedEdge = null;
    }

    /// <summary>A node's cascade inputs: its depth/branch context and its cluster's root id.</summary>
    private readonly record struct NodeStyleInfo(StyleContext Context, string RootId);

    /// <summary>
    /// Computes each node's <see cref="StyleContext"/> (depth, depth-1 branch index, is-root) from the
    /// hierarchy edges, so the style cascade can apply depth-band rules and branch coloring.
    /// </summary>
    private static Dictionary<string, NodeStyleInfo> BuildStyleContexts(MindmapDocument document)
    {
        var infos = new Dictionary<string, NodeStyleInfo>();
        var nodeIds = document.Elements.Where(e => e.Kind == ElementKind.Node).Select(e => e.Id).ToHashSet();
        if (nodeIds.Count == 0)
            return infos;

        var childrenOf = new Dictionary<string, List<string>>();
        var parentOf = new Dictionary<string, string>();
        foreach (var edge in document.Edges.Where(e =>
                     e.Kind == EdgeKind.Hierarchy && nodeIds.Contains(e.FromId) && nodeIds.Contains(e.ToId)))
        {
            if (!childrenOf.TryGetValue(edge.FromId, out var kids))
            {
                kids = new List<string>();
                childrenOf[edge.FromId] = kids;
            }
            kids.Add(edge.ToId);
            parentOf[edge.ToId] = edge.FromId;
        }

        foreach (var root in nodeIds.Where(id => !parentOf.ContainsKey(id)))
        {
            infos[root] = new NodeStyleInfo(StyleContext.Root, root);

            void Walk(string id, int depth, int branchIndex)
            {
                if (!childrenOf.TryGetValue(id, out var kids))
                    return;
                for (var j = 0; j < kids.Count; j++)
                {
                    // A depth-1 child seeds a new branch; deeper nodes inherit their ancestor's branch.
                    var childBranch = depth == 0 ? j : branchIndex;
                    infos[kids[j]] = new NodeStyleInfo(new StyleContext(depth + 1, childBranch, false), root);
                    Walk(kids[j], depth + 1, childBranch);
                }
            }

            Walk(root, 0, -1);
        }

        return infos;
    }

    /// <summary>
    /// Builds a <see cref="LayoutSnapshot"/> per cluster (one hierarchy tree), runs the layout service for
    /// each, and merges the positions. Unpinned clusters are stacked so multiple root trees don't overlap;
    /// a cluster with a pinned root is honored where it sits.
    /// </summary>
    private async Task<Dictionary<string, LayoutPosition>> ComputeLayoutAsync(MindmapDocument document)
    {
        var merged = new Dictionary<string, LayoutPosition>();

        var nodeById = document.Elements
            .Where(e => e.Kind == ElementKind.Node)
            .ToDictionary(e => e.Id);
        if (nodeById.Count == 0)
            return merged;

        var hierarchy = document.Edges
            .Where(e => e.Kind == EdgeKind.Hierarchy && nodeById.ContainsKey(e.FromId) && nodeById.ContainsKey(e.ToId))
            .ToList();

        var childrenOf = new Dictionary<string, List<string>>();
        var parentOf = new Dictionary<string, string>();
        var orderOf = new Dictionary<string, int>();
        foreach (var edge in hierarchy)
        {
            if (!childrenOf.TryGetValue(edge.FromId, out var kids))
            {
                kids = new List<string>();
                childrenOf[edge.FromId] = kids;
            }
            orderOf[edge.ToId] = kids.Count;
            kids.Add(edge.ToId);
            parentOf[edge.ToId] = edge.FromId;
        }

        var roots = nodeById.Values.Where(e => !parentOf.ContainsKey(e.Id)).Select(e => e.Id);
        var clusterSettings = document.Clusters.ToDictionary(c => c.RootId);
        var stackTop = 0.0;

        foreach (var rootId in roots)
        {
            var clusterNodes = new List<LayoutNode>();
            void Collect(string id)
            {
                var element = nodeById[id];
                clusterNodes.Add(new LayoutNode
                {
                    Id = id,
                    ParentId = parentOf.GetValueOrDefault(id),
                    Order = orderOf.GetValueOrDefault(id),
                    Width = element.Width ?? MindmapNodeItem.DefaultWidth,
                    Height = element.Height ?? MindmapNodeItem.DefaultHeight,
                    Collapsed = element.Collapsed,
                    Pinned = element.Pinned,
                    X = element.X,
                    Y = element.Y,
                });
                if (childrenOf.TryGetValue(id, out var kids))
                    foreach (var kid in kids)
                        Collect(kid);
            }
            Collect(rootId);

            var settings = clusterSettings.GetValueOrDefault(rootId);
            var snapshot = new LayoutSnapshot
            {
                RootId = rootId,
                Nodes = clusterNodes,
                Algorithm = settings?.LayoutAlgorithm ?? MindmapLayoutAlgorithms.Balanced,
                Options = settings?.Options,
                Revision = document.Revision,
            };

            IReadOnlyDictionary<string, LayoutPosition> clusterPositions;
            try
            {
                var result = await _layout.ComputeAsync(snapshot).ConfigureAwait(true);
                clusterPositions = result.IsSuccess && result.Value is not null
                    ? result.Value.Positions
                    : FallbackPositions(clusterNodes);
            }
            catch (Exception ex)
            {
                _logger.Error("Mindmap", $"Layout failed for cluster '{rootId}'; using stored positions.", ex);
                clusterPositions = FallbackPositions(clusterNodes);
            }

            MergeCluster(merged, clusterPositions, clusterNodes, nodeById[rootId].Pinned, ref stackTop);
        }

        return merged;
    }

    private static Dictionary<string, LayoutPosition> FallbackPositions(IReadOnlyList<LayoutNode> nodes)
    {
        var positions = new Dictionary<string, LayoutPosition>();
        foreach (var node in nodes)
            positions[node.Id] = new LayoutPosition(node.X, node.Y);
        return positions;
    }

    private static void MergeCluster(
        Dictionary<string, LayoutPosition> merged,
        IReadOnlyDictionary<string, LayoutPosition> cluster,
        IReadOnlyList<LayoutNode> clusterNodes,
        bool rootPinned,
        ref double stackTop)
    {
        const double clusterGap = 64;

        if (rootPinned || cluster.Count == 0)
        {
            foreach (var (id, position) in cluster)
                merged[id] = position;
            return;
        }

        // Stack unpinned clusters vertically so separate root trees never sit on top of each other.
        var sizeById = clusterNodes.ToDictionary(n => n.Id);
        double minY = double.MaxValue, maxY = double.MinValue;
        foreach (var (id, position) in cluster)
        {
            minY = Math.Min(minY, position.Y);
            maxY = Math.Max(maxY, position.Y + sizeById[id].Height);
        }

        var dy = stackTop - minY;
        foreach (var (id, position) in cluster)
            merged[id] = new LayoutPosition(position.X, position.Y + dy);
        stackTop = maxY + dy + clusterGap;
    }

    private static string NodeText(IElementContent content) => content switch
    {
        TextContent t => t.Text,
        TaskContent task => task.Text,
        CodeContent code => code.Source,
        LinkContent link => link.Title ?? link.Url,
        MathContent math => math.Latex,
        FreeTextContent free => free.Text,
        ShapeContent shape => shape.Text ?? string.Empty,
        FrameContent frame => frame.Title,
        _ => string.Empty,
    };

    private static double DefaultFreeWidth(ElementKind kind) =>
        kind == ElementKind.Text ? MindmapNodeItem.TextDefaultWidth : MindmapNodeItem.ShapeDefaultWidth;

    private static double DefaultFreeHeight(ElementKind kind) =>
        kind == ElementKind.Text ? MindmapNodeItem.TextDefaultHeight : MindmapNodeItem.ShapeDefaultHeight;

    // --- Selection ---------------------------------------------------------

    private const double ToolbarGap = 12;
    private const double ToolbarHeight = 40;

    // The edge toolbar is centered on the edge midpoint; this nudges its left edge by ~half its width.
    private const double EdgeToolbarHalfWidth = 130;

    public void Select(MindmapNodeItem? node)
    {
        // Node and edge selection are mutually exclusive; picking a node (or empty space) drops any edge.
        if (SelectedEdge is { } selectedEdge)
        {
            selectedEdge.IsSelected = false;
            SelectedEdge = null;
        }

        // Only toggle the two affected items; looping every node fired a property-change and canvas
        // invalidate per element on every click, which dragged on large maps.
        if (SelectedNode is { } previous && !ReferenceEquals(previous, node))
            previous.IsSelected = false;
        if (node is not null)
            node.IsSelected = true;
        SelectedNode = node;
        ((AsyncRelayCommand)DeleteSelectedCommand).NotifyCanExecuteChanged();
    }

    /// <summary>Selects a link edge (clearing any node selection) so its floating toolbar appears.</summary>
    public void SelectEdge(MindmapEdgeItem? edge)
    {
        if (SelectedEdge is { } previous && !ReferenceEquals(previous, edge))
            previous.IsSelected = false;

        // Selecting an edge drops the node selection (and hides the node toolbar).
        if (edge is not null && SelectedNode is { } node)
        {
            node.IsSelected = false;
            SelectedNode = null;
        }

        if (edge is not null)
            edge.IsSelected = true;
        SelectedEdge = edge;
    }

    partial void OnSelectedNodeChanged(MindmapNodeItem? oldValue, MindmapNodeItem? newValue)
    {
        if (oldValue is not null)
            oldValue.PropertyChanged -= OnSelectedNodeMoved;
        if (newValue is not null)
            newValue.PropertyChanged += OnSelectedNodeMoved;

        // Show the node's custom colors in the inspector hex fields (blank when it uses theme tokens).
        FillHex = HexOrEmpty(newValue?.FillToken);
        StrokeHex = HexOrEmpty(newValue?.StrokeToken);
        TextHex = HexOrEmpty(newValue?.TextToken);

        SyncClusterTemplateSelection();
        UpdateSelectionToolbar();
    }

    private void OnSelectedNodeMoved(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName is nameof(MindmapNodeItem.X) or nameof(MindmapNodeItem.Y)
            or nameof(MindmapNodeItem.Width) or nameof(MindmapNodeItem.Height))
            UpdateSelectionToolbar();
    }

    // Floats the style toolbar just above the selected node, following pan, zoom and drag.
    private void UpdateSelectionToolbar()
    {
        var node = SelectedNode;
        if (node is null)
        {
            IsSelectionToolbarVisible = false;
            return;
        }

        var topLeft = _camera.ContentToScreen(new Point(node.X, node.Y));
        SelectionToolbarLeft = topLeft.X;

        // Sit above the node; if that runs past the top of the viewport, flip below it instead.
        var above = topLeft.Y - ToolbarHeight - ToolbarGap;
        SelectionToolbarTop = above >= ToolbarGap
            ? above
            : _camera.ContentToScreen(new Point(node.X, node.Y + node.Height)).Y + ToolbarGap;
        IsSelectionToolbarVisible = true;
    }

    // Applies an op to the selected node, then reselects it so the toolbar stays open on the same node.
    private async Task ApplyToSelectionAsync(MindmapEditOp op)
    {
        if (SelectedNode is null)
            return;
        var id = SelectedNode.Id;
        await ApplyAsync(op, selectRef: null).ConfigureAwait(true);
        Select(Nodes.FirstOrDefault(n => n.Id == id));
    }

    partial void OnSelectedEdgeChanged(MindmapEdgeItem? oldValue, MindmapEdgeItem? newValue)
    {
        if (oldValue is not null)
            oldValue.PropertyChanged -= OnSelectedEdgeMoved;
        if (newValue is not null)
            newValue.PropertyChanged += OnSelectedEdgeMoved;
        UpdateEdgeToolbar();
    }

    private void OnSelectedEdgeMoved(object? sender, PropertyChangedEventArgs e)
    {
        // The midpoint shifts when either endpoint moves; the edge item raises Start/End then.
        if (e.PropertyName is nameof(MindmapEdgeItem.Start) or nameof(MindmapEdgeItem.End))
            UpdateEdgeToolbar();
    }

    // Floats the edge toolbar just above the selected edge's midpoint, following pan, zoom and endpoint drags.
    private void UpdateEdgeToolbar()
    {
        var edge = SelectedEdge;
        if (edge is null)
        {
            IsEdgeToolbarVisible = false;
            return;
        }

        var mid = _camera.ContentToScreen(edge.Midpoint);
        EdgeToolbarLeft = mid.X - EdgeToolbarHalfWidth;

        var above = mid.Y - ToolbarHeight - ToolbarGap;
        EdgeToolbarTop = above >= ToolbarGap ? above : mid.Y + ToolbarGap;
        IsEdgeToolbarVisible = true;
    }

    // Applies an op to the selected edge, then reselects it by id so the toolbar stays open (or hides on delete).
    private async Task ApplyToEdgeAsync(MindmapEditOp op)
    {
        if (SelectedEdge is null)
            return;
        var id = SelectedEdge.Id;
        await ApplyAsync(op, selectRef: null).ConfigureAwait(true);
        SelectEdge(Edges.FirstOrDefault(e => e.Id == id));
    }

    [RelayCommand]
    private Task SetEdgeLineAsync(string? style) =>
        SelectedEdge is null || !System.Enum.TryParse<LineStyle>(style, out var line)
            ? Task.CompletedTask
            : ApplyToEdgeAsync(new SetEdgeOp { EdgeId = SelectedEdge.Id, Style = new EdgeStyle { Line = line } });

    [RelayCommand]
    private Task SetEdgeColorAsync(string? token) =>
        SelectedEdge is null || string.IsNullOrEmpty(token)
            ? Task.CompletedTask
            : ApplyToEdgeAsync(new SetEdgeOp { EdgeId = SelectedEdge.Id, Style = new EdgeStyle { Color = token } });

    [RelayCommand]
    private Task ToggleEdgeStartCapAsync() =>
        SelectedEdge is null
            ? Task.CompletedTask
            : ApplyToEdgeAsync(new SetEdgeOp
            {
                EdgeId = SelectedEdge.Id,
                Style = new EdgeStyle { StartCap = SelectedEdge.StartCap == ArrowCap.Arrow ? ArrowCap.None : ArrowCap.Arrow },
            });

    [RelayCommand]
    private Task ToggleEdgeEndCapAsync() =>
        SelectedEdge is null
            ? Task.CompletedTask
            : ApplyToEdgeAsync(new SetEdgeOp
            {
                EdgeId = SelectedEdge.Id,
                Style = new EdgeStyle { EndCap = SelectedEdge.EndCap == ArrowCap.Arrow ? ArrowCap.None : ArrowCap.Arrow },
            });

    [RelayCommand]
    private Task DeleteEdgeAsync() =>
        SelectedEdge is null
            ? Task.CompletedTask
            : ApplyToEdgeAsync(new UnlinkOp { EdgeId = SelectedEdge.Id });

    [RelayCommand]
    private Task SetFillAsync(string? token) =>
        SelectedNode is null || string.IsNullOrEmpty(token)
            ? Task.CompletedTask
            : ApplyToSelectionAsync(new SetOp { Id = SelectedNode.Id, Style = new ElementStyle { Fill = token } });

    [RelayCommand]
    private Task SetStrokeAsync(string? token) =>
        SelectedNode is null || string.IsNullOrEmpty(token)
            ? Task.CompletedTask
            : ApplyToSelectionAsync(new SetOp { Id = SelectedNode.Id, Style = new ElementStyle { Stroke = token } });

    [RelayCommand]
    private Task SetTextColorAsync(string? token) =>
        SelectedNode is null || string.IsNullOrEmpty(token)
            ? Task.CompletedTask
            : ApplyToSelectionAsync(new SetOp { Id = SelectedNode.Id, Style = new ElementStyle { TextColor = token } });

    [RelayCommand]
    private void ToggleInspector() => IsInspectorOpen = !IsInspectorOpen;

    [RelayCommand]
    private Task SetFillHexAsync() => TryHex(FillHex) is { } token ? SetFillAsync(token) : Task.CompletedTask;

    [RelayCommand]
    private Task SetStrokeHexAsync() => TryHex(StrokeHex) is { } token ? SetStrokeAsync(token) : Task.CompletedTask;

    [RelayCommand]
    private Task SetTextHexAsync() => TryHex(TextHex) is { } token ? SetTextColorAsync(token) : Task.CompletedTask;

    /// <summary>Normalizes a user-entered hex color, or null if it doesn't parse.</summary>
    private static string? TryHex(string? input) =>
        !string.IsNullOrWhiteSpace(input) && Color.TryParse(input, out var color) ? color.ToString() : null;

    private static string HexOrEmpty(string? token) =>
        token is not null && token.StartsWith('#') ? token : string.Empty;

    [RelayCommand]
    private Task SetShapeAsync(string? name) =>
        SelectedNode is not null && Enum.TryParse<NodeShape>(name, out var shape)
            ? ApplyToSelectionAsync(new SetOp { Id = SelectedNode.Id, Style = new ElementStyle { NodeShape = shape } })
            : Task.CompletedTask;

    [RelayCommand]
    private Task SetFontScaleAsync(string? name) =>
        SelectedNode is not null && Enum.TryParse<FontScale>(name, out var scale)
            ? ApplyToSelectionAsync(new SetOp { Id = SelectedNode.Id, Style = new ElementStyle { FontScale = scale } })
            : Task.CompletedTask;

    [RelayCommand]
    private Task ToggleCollapseAsync()
    {
        if (SelectedNode is null || _document is null)
            return Task.CompletedTask;
        var element = _document.Elements.FirstOrDefault(e => e.Id == SelectedNode.Id);
        return element is null
            ? Task.CompletedTask
            : ApplyToSelectionAsync(new SetOp { Id = SelectedNode.Id, Collapsed = !element.Collapsed });
    }

    [RelayCommand]
    private Task TogglePinAsync() =>
        SelectedNode is null
            ? Task.CompletedTask
            : ApplyToSelectionAsync(new SetOp { Id = SelectedNode.Id, Pinned = !SelectedNode.IsPinned });

    // Pushes the node's own style overrides down onto its whole subtree.
    [RelayCommand]
    private Task StyleSubtreeAsync()
    {
        if (SelectedNode is null || _document is null)
            return Task.CompletedTask;
        var element = _document.Elements.FirstOrDefault(e => e.Id == SelectedNode.Id);
        return element?.Style is null
            ? Task.CompletedTask
            : ApplyToSelectionAsync(new StyleSubtreeOp { Root = SelectedNode.Id, Style = element.Style });
    }

    // Drops the node's override so it falls back to the template default.
    [RelayCommand]
    private Task ClearNodeStyleAsync() =>
        SelectedNode is null
            ? Task.CompletedTask
            : ApplyToSelectionAsync(new SetOp { Id = SelectedNode.Id, ClearStyle = true });

    // Saves the selected node's styled subtree as a reusable user template. A dialog captures a name and how
    // many depth levels to snapshot; each level becomes its own depth band, so the template reproduces the
    // look level by level rather than only cloning the root. The result joins the top-bar picker.
    [RelayCommand]
    private async Task SaveStyleAsTemplateAsync()
    {
        if (SelectedNode is null || _document is null || _overlay is null)
            return;

        var rootId = SelectedNode.Id;
        var availableLevels = MindmapTemplateCapture.AvailableLevels(_document, rootId);
        if (availableLevels <= 0)
            return;

        var choice = await PromptSaveTemplateAsync(availableLevels).ConfigureAwait(true);
        if (choice is null || string.IsNullOrWhiteSpace(choice.Name))
            return;

        var template = MindmapTemplateCapture.Capture(
            _document, rootId, $"user-{Guid.NewGuid():N}", choice.Name.Trim(), choice.Levels);

        try
        {
            await _templates.SaveAsync(template).ConfigureAwait(true);
            RebuildTemplatePicker();
        }
        catch (Exception ex)
        {
            _logger.Error("Mindmap", "Failed to save style template.", ex);
        }
    }

    // Shows the save-as-template dialog, resolving with the user's name + level choice, or null if cancelled.
    private Task<MindmapSaveTemplateResult?> PromptSaveTemplateAsync(int availableLevels)
    {
        var tcs = new TaskCompletionSource<MindmapSaveTemplateResult?>();
        var overlay = new MindmapSaveTemplateOverlay();
        overlay.Initialize(availableLevels, defaultLevels: availableLevels);
        var id = _overlay!.CreateOverlay(overlay, new OverlayOptions
        {
            HorizontalAlignment = Avalonia.Layout.HorizontalAlignment.Center,
            VerticalAlignment = Avalonia.Layout.VerticalAlignment.Center,
            ShowBackdrop = true,
            CloseOnOutsideClick = false,
        }, "MindmapSaveTemplate");
        overlay.Completed = result =>
        {
            _overlay.CloseOverlay(id);
            tcs.TrySetResult(result);
        };
        return tcs.Task;
    }

    // Deletes the user template currently chosen in the picker (built-ins are not deletable). Any map still
    // referencing it falls back to the default template via the cascade.
    [RelayCommand]
    private async Task DeleteSelectedTemplateAsync()
    {
        if (_overlay is null || SelectedTemplateOption is not { IsUser: true } option)
            return;

        var deleteLabel = Tr("Delete", "Delete");
        var confirm = await _overlay.CreateDialogAsync(
            Tr("DeleteTemplateTitle", "Delete template"),
            string.Format(CultureInfo.CurrentCulture, Tr("DeleteTemplateMessage", "Delete the template \"{0}\"?"), option.Label),
            deleteLabel,
            Tr("Cancel", "Cancel"),
            confirmIconName: "Common/trash",
            severity: DialogSeverity.Destructive).ConfigureAwait(true);
        if (confirm != deleteLabel)
            return;

        try
        {
            await _templates.DeleteAsync(option.Id).ConfigureAwait(true);
            RebuildTemplatePicker();
        }
        catch (Exception ex)
        {
            _logger.Error("Mindmap", "Failed to delete style template.", ex);
        }
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
        UpdateSelectionToolbar();
        UpdateEdgeToolbar();
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

        // Tree editing only applies to nodes; a selected free element (shape/text) has no hierarchy.
        if (SelectedNode.IsFree)
            return;

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

        if (SelectedNode.IsFree)
            return;

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

    /// <summary>Places a free text label centered on the given content point and selects it.</summary>
    public Task CreateFreeTextAsync(Point contentPoint) =>
        AddFreeElementAsync(
            ElementKind.Text,
            new FreeTextContent { Text = T("NewText") },
            MindmapNodeItem.TextDefaultWidth,
            MindmapNodeItem.TextDefaultHeight,
            contentPoint);

    /// <summary>Places a free shape of the given geometry centered on the content point and selects it.</summary>
    public Task CreateShapeAsync(ShapeType shape, Point contentPoint) =>
        AddFreeElementAsync(
            ElementKind.Shape,
            new ShapeContent { Shape = shape },
            MindmapNodeItem.ShapeDefaultWidth,
            MindmapNodeItem.ShapeDefaultHeight,
            contentPoint);

    /// <summary>Creates a link edge (connector) between two elements. No-op if they are the same element.</summary>
    public async Task LinkAsync(string fromId, string toId)
    {
        if (fromId == toId)
            return;
        await ApplyAsync(new LinkOp { A = fromId, B = toId }, selectRef: null).ConfigureAwait(true);
    }

    /// <summary>Places an empty frame centered on the content point and selects it. Members are added later by dragging.</summary>
    public Task CreateFrameAsync(Point contentPoint) =>
        AddFreeElementAsync(
            ElementKind.Frame,
            new FrameContent { Title = T("NewFrame") },
            MindmapNodeItem.FrameDefaultWidth,
            MindmapNodeItem.FrameDefaultHeight,
            contentPoint);

    private Task AddFreeElementAsync(ElementKind kind, IElementContent content, double width, double height, Point center) =>
        ApplyAsync(new AddElementOp
        {
            Ref = "new",
            Kind = kind,
            Content = content,
            X = center.X - width / 2,
            Y = center.Y - height / 2,
            Width = width,
            Height = height,
        }, selectRef: "new");

    private Task AddRootAsync() => ApplyAsync(new AddNodesOp
    {
        Nodes = new[] { new MindmapNodeSpec { Ref = "new", Text = T("NewNode") } },
    }, selectRef: "new");

    public async Task MoveNodeAsync(string nodeId, Point contentPosition)
    {
        await ApplyAsync(new MoveOp { Id = nodeId, X = contentPosition.X, Y = contentPosition.Y }, selectRef: null).ConfigureAwait(true);
    }

    /// <summary>Pins or releases a node. Releasing lets it rejoin auto-layout on the next pass.</summary>
    public async Task SetPinnedAsync(string nodeId, bool pinned)
    {
        await ApplyAsync(new SetOp { Id = nodeId, Pinned = pinned }, selectRef: null).ConfigureAwait(true);
    }

    private async Task DeleteSelectedAsync()
    {
        if (SelectedNode is null)
            return;
        await ApplyAsync(new DeleteOp { Ids = new[] { SelectedNode.Id } }, selectRef: null).ConfigureAwait(true);
    }

    private Task ApplyAsync(MindmapEditOp op, string? selectRef) =>
        ApplyOpsAsync(new[] { op }, selectRef);

    private async Task ApplyOpsAsync(IReadOnlyList<MindmapEditOp> ops, string? selectRef)
    {
        var before = _document;
        try
        {
            var result = await _service.ApplyAsync(MapId, Revision, ops).ConfigureAwait(true);
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
