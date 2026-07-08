using System;
using System.Collections.Generic;
using System.Linq;
using Mnemo.Core.Models.Mindmap;
using Mnemo.Infrastructure.Services.Mindmap.Persistence;

namespace Mnemo.Infrastructure.Services.Mindmap;

/// <summary>
/// The mutable staging area a single edit batch works in. The public <see cref="MindmapDocument"/> is
/// immutable; this internal type is the one place a new document state is assembled, so nothing
/// outside the command layer can reach in and mutate. It also tracks, per batch, which elements to
/// re-index for FTS and which element/edge ids changed (for the change log), so the save path stays
/// incremental.
/// </summary>
internal sealed class MindmapWorkingDocument
{
    private readonly MindmapShortIdGenerator _idGenerator;

    private readonly Dictionary<string, MindmapElement> _elements = new();
    private readonly List<string> _elementOrder = new();
    private readonly Dictionary<string, MindmapEdge> _edges = new();
    private readonly List<string> _edgeOrder = new();
    private readonly Dictionary<string, ClusterSettings> _clusters = new();

    private readonly HashSet<string> _allIds = new();
    private readonly HashSet<string> _touched = new();       // elements needing FTS re-index
    private readonly HashSet<string> _removed = new();       // elements needing FTS removal
    private readonly HashSet<string> _changeTouched = new(); // element/edge/cluster ids changed (change log)

    public string Id { get; }
    public string Title { get; private set; }
    public DateTime CreatedAt { get; }
    public MindmapCanvasOptions Canvas { get; private set; }

    public MindmapWorkingDocument(MindmapDocument document, MindmapShortIdGenerator idGenerator)
    {
        _idGenerator = idGenerator;
        Id = document.Id;
        Title = document.Title;
        CreatedAt = document.CreatedAt;
        Canvas = document.Canvas;

        foreach (var element in document.Elements)
        {
            _elements[element.Id] = element;
            _elementOrder.Add(element.Id);
            _allIds.Add(element.Id);
        }

        foreach (var edge in document.Edges)
        {
            _edges[edge.Id] = edge;
            _edgeOrder.Add(edge.Id);
            _allIds.Add(edge.Id);
        }

        foreach (var cluster in document.Clusters)
            _clusters[cluster.RootId] = cluster;
    }

    public MindmapWorkingDocument(string id, string title, DateTime createdAt, MindmapCanvasOptions canvas, MindmapShortIdGenerator idGenerator)
    {
        _idGenerator = idGenerator;
        Id = id;
        Title = title;
        CreatedAt = createdAt;
        Canvas = canvas;
    }

    public IEnumerable<MindmapElement> Elements => _elementOrder.Select(id => _elements[id]);

    public IEnumerable<MindmapEdge> Edges => _edgeOrder.Select(id => _edges[id]);

    public IReadOnlySet<string> ChangeTouchedIds => _changeTouched;

    public bool TryGetElement(string id, out MindmapElement element) => _elements.TryGetValue(id, out element!);

    public bool ContainsElement(string id) => _elements.ContainsKey(id);

    public bool TryGetEdge(string id, out MindmapEdge edge) => _edges.TryGetValue(id, out edge!);

    /// <summary>Reserves and returns a fresh document-unique id.</summary>
    public string NewId()
    {
        var id = _idGenerator.Next(_allIds);
        _allIds.Add(id);
        return id;
    }

    public void AddElement(MindmapElement element)
    {
        _elements[element.Id] = element;
        _elementOrder.Add(element.Id);
        _allIds.Add(element.Id);
        _touched.Add(element.Id);
        _changeTouched.Add(element.Id);
    }

    /// <summary>Replaces an existing element in place (same order). Immutable-record semantics.</summary>
    public void ReplaceElement(MindmapElement element)
    {
        _elements[element.Id] = element;
        _touched.Add(element.Id);
        _changeTouched.Add(element.Id);
    }

    public void RemoveElement(string id)
    {
        if (!_elements.Remove(id))
            return;

        _elementOrder.Remove(id);
        _allIds.Remove(id);
        _touched.Remove(id);
        _removed.Add(id);
        _changeTouched.Add(id);
        _clusters.Remove(id);
    }

    public void AddEdge(MindmapEdge edge, string? insertAfterEdgeId)
    {
        _edges[edge.Id] = edge;
        _allIds.Add(edge.Id);
        _changeTouched.Add(edge.Id);

        if (insertAfterEdgeId is null)
        {
            _edgeOrder.Add(edge.Id);
            return;
        }

        var index = _edgeOrder.IndexOf(insertAfterEdgeId);
        if (index < 0)
            _edgeOrder.Add(edge.Id);
        else
            _edgeOrder.Insert(index + 1, edge.Id);
    }

    public void RemoveEdge(string id)
    {
        if (!_edges.Remove(id))
            return;

        _edgeOrder.Remove(id);
        _allIds.Remove(id);
        _changeTouched.Add(id);
    }

    /// <summary>Replaces an existing edge in place (same id, preserved order), marking it changed.</summary>
    public void ReplaceEdge(MindmapEdge edge)
    {
        if (!_edges.ContainsKey(edge.Id))
            return;

        _edges[edge.Id] = edge;
        _changeTouched.Add(edge.Id);
    }

    /// <summary>Edges incident to an element (either endpoint), in document order.</summary>
    public IEnumerable<MindmapEdge> IncidentEdges(string elementId) =>
        _edgeOrder.Select(id => _edges[id]).Where(e => e.FromId == elementId || e.ToId == elementId);

    /// <summary>First edge matching the predicate in document order, or null.</summary>
    public MindmapEdge? FindEdge(Func<MindmapEdge, bool> predicate)
    {
        foreach (var id in _edgeOrder)
        {
            var edge = _edges[id];
            if (predicate(edge))
                return edge;
        }

        return null;
    }

    public ClusterSettings GetOrDefaultCluster(string rootId) =>
        _clusters.TryGetValue(rootId, out var settings) ? settings : new ClusterSettings { RootId = rootId };

    public void SetCluster(string rootId, ClusterSettings settings)
    {
        _clusters[rootId] = settings;
        _changeTouched.Add(rootId);
    }

    public void SetCanvas(MindmapCanvasOptions canvas) => Canvas = canvas;

    public MindmapDocument Materialize(long revision, DateTime modifiedAt) =>
        new()
        {
            Id = Id,
            Title = Title,
            SchemaVersion = 2,
            Revision = revision,
            CreatedAt = CreatedAt,
            ModifiedAt = modifiedAt,
            Elements = _elementOrder.Select(id => _elements[id]).ToList(),
            Edges = _edgeOrder.Select(id => _edges[id]).ToList(),
            // Prune settings for roots that no longer exist.
            Clusters = _clusters.Values.Where(c => _elements.ContainsKey(c.RootId)).ToList(),
            Canvas = Canvas,
        };

    /// <summary>
    /// Builds the incremental FTS delta for this batch. Elements with no searchable text are removed from
    /// the mirror rather than stored as empty rows, so clearing an element's text drops its row.
    /// </summary>
    public MindmapSearchDelta BuildSearchDelta(bool fullReplace)
    {
        var upserts = new List<MindmapSearchEntry>();

        if (fullReplace)
        {
            foreach (var id in _elementOrder)
            {
                var text = MindmapSearchText.Extract(_elements[id]);
                if (!string.IsNullOrEmpty(text))
                    upserts.Add(new MindmapSearchEntry(id, text));
            }

            return new MindmapSearchDelta { Upserts = upserts, FullReplace = true };
        }

        var removed = new List<string>(_removed);
        foreach (var id in _touched)
        {
            if (!_elements.TryGetValue(id, out var element))
                continue;

            var text = MindmapSearchText.Extract(element);
            if (string.IsNullOrEmpty(text))
                removed.Add(id);
            else
                upserts.Add(new MindmapSearchEntry(id, text));
        }

        return new MindmapSearchDelta { Upserts = upserts, Removed = removed, FullReplace = false };
    }
}
