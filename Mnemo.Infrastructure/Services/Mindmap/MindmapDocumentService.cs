using System;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Mindmap;
using Mnemo.Core.Services;
using Mnemo.Infrastructure.Services.Mindmap.Persistence;

namespace Mnemo.Infrastructure.Services.Mindmap;

/// <summary>
/// Schema v2 mindmap service (see <see cref="IMindmapService"/>). It is the single command layer:
/// every mutation flows through <see cref="ApplyAsync"/>, which enforces the graph invariants
/// (forest/cycle/cascade), assigns short ids, bumps the revision, maintains the FTS mirror incrementally,
/// and records the change log used to rebase non-contending stale-revision batches. Reads prune
/// dangling edges in memory so a deleted reference never breaks a document.
/// </summary>
public sealed class MindmapDocumentService : IMindmapService
{
    private readonly IMindmapStore _store;
    private readonly ILoggerService _logger;
    private readonly MindmapShortIdGenerator _idGenerator;
    private readonly MindmapChangeLog _changeLog = new();
    private readonly ConcurrentDictionary<string, SemaphoreSlim> _mapGates = new();

    /// <inheritdoc />
    public event EventHandler<MindmapChangedEventArgs>? Changed;

    /// <param name="idGenerator">Optional short-id generator (tests inject a deterministic one).</param>
    public MindmapDocumentService(IMindmapStore store, ILoggerService logger, MindmapShortIdGenerator? idGenerator = null)
    {
        _store = store;
        _logger = logger;
        _idGenerator = idGenerator ?? new MindmapShortIdGenerator();
    }

    public async Task<Result<MindmapDocument>> CreateAsync(
        string title,
        IReadOnlyList<MindmapNodeSpec>? outline = null,
        string? layoutAlgorithm = null,
        string? templateId = null,
        string? folderId = null,
        CancellationToken cancellationToken = default)
    {
        (string Id, long Revision)? committed = null;
        try
        {
            var now = DateTime.UtcNow;
            var canvas = templateId is null ? new MindmapCanvasOptions() : new MindmapCanvasOptions { DefaultTemplateId = templateId };
            var working = new MindmapWorkingDocument(Guid.NewGuid().ToString(), title, now, canvas, _idGenerator);
            var accumulator = new EditAccumulator();

            if (outline is { Count: > 0 })
            {
                var error = ApplyAddNodes(working, new AddNodesOp { Nodes = outline }, accumulator);
                if (error is not null)
                    return Result<MindmapDocument>.Failure($"Invalid outline: {error.Message}");
            }

            if (!string.IsNullOrEmpty(layoutAlgorithm))
            {
                foreach (var root in RootNodeIds(working))
                    working.SetCluster(root, new ClusterSettings { RootId = root, LayoutAlgorithm = layoutAlgorithm });
            }

            const long initialRevision = 1;
            var document = working.Materialize(initialRevision, now);
            await _store.SaveAsync(document, working.BuildSearchDelta(fullReplace: true), cancellationToken).ConfigureAwait(false);
            if (!string.IsNullOrEmpty(folderId))
                await _store.SetFolderAsync(document.Id, folderId, cancellationToken).ConfigureAwait(false);
            _changeLog.Record(document.Id, initialRevision, working.ChangeTouchedIds);
            committed = (document.Id, initialRevision);
            return document;
        }
        catch (Exception ex)
        {
            _logger.Error("Mindmap", "Failed to create mindmap.", ex);
            return Result<MindmapDocument>.Failure("Failed to create mindmap.", ex);
        }
        finally
        {
            if (committed is { } c)
                RaiseChanged(c.Id, c.Revision, MindmapChangeKind.Created);
        }
    }

    public async Task<Result<MindmapDocument>> GetAsync(string id, CancellationToken cancellationToken = default)
    {
        try
        {
            var document = await _store.LoadAsync(id, cancellationToken).ConfigureAwait(false);
            if (document is null)
                return Result<MindmapDocument>.Failure($"Mindmap '{id}' was not found.");

            if (document.SchemaVersion != 2)
                return Result<MindmapDocument>.Failure($"Mindmap '{id}' uses unsupported schema version {document.SchemaVersion}.");

            return PruneDanglingEdges(document);
        }
        catch (Exception ex)
        {
            _logger.Error("Mindmap", $"Failed to load mindmap '{id}'.", ex);
            return Result<MindmapDocument>.Failure($"Failed to load mindmap '{id}'.", ex);
        }
    }

    public async Task<Result<MindmapFindResult>> FindInMapAsync(string mapId, string query, int limit, CancellationToken cancellationToken = default)
    {
        try
        {
            var document = await _store.LoadAsync(mapId, cancellationToken).ConfigureAwait(false);
            if (document is null)
                return Result<MindmapFindResult>.Failure($"Mindmap '{mapId}' was not found.");
            if (document.SchemaVersion != 2)
                return Result<MindmapFindResult>.Failure($"Mindmap '{mapId}' uses unsupported schema version {document.SchemaVersion}.");

            // An empty query has no meaningful FTS match; return the revision with no hits so the caller can
            // still proceed (and carry the rev into an edit) rather than treating it as an error.
            if (string.IsNullOrWhiteSpace(query))
                return Result<MindmapFindResult>.Success(new MindmapFindResult { Revision = document.Revision });

            var boundedLimit = limit <= 0 ? 20 : limit;
            var hits = await _store.SearchAsync(mapId, query, boundedLimit, cancellationToken).ConfigureAwait(false);
            if (hits.Count == 0)
                return Result<MindmapFindResult>.Success(new MindmapFindResult { Revision = document.Revision });

            var byId = document.Elements.ToDictionary(e => e.Id);
            var parentOf = BuildHierarchyParentMap(document);
            var findHits = hits
                .Select(h => new MindmapFindHit
                {
                    ElementId = h.ElementId,
                    Text = h.Text,
                    Path = BuildHierarchyPath(h.ElementId, parentOf, byId),
                })
                .ToList();

            return Result<MindmapFindResult>.Success(new MindmapFindResult { Revision = document.Revision, Hits = findHits });
        }
        catch (Exception ex)
        {
            _logger.Error("Mindmap", $"Failed to search mindmap '{mapId}'.", ex);
            return Result<MindmapFindResult>.Failure($"Failed to search mindmap '{mapId}'.", ex);
        }
    }

    public async Task<Result<IReadOnlyList<MindmapDocumentSummary>>> ListAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            var summaries = await _store.ListAsync(cancellationToken).ConfigureAwait(false);
            return Result<IReadOnlyList<MindmapDocumentSummary>>.Success(summaries);
        }
        catch (Exception ex)
        {
            _logger.Error("Mindmap", "Failed to list mindmaps.", ex);
            return Result<IReadOnlyList<MindmapDocumentSummary>>.Failure("Failed to list mindmaps.", ex);
        }
    }

    public async Task<Result> DeleteAsync(string id, CancellationToken cancellationToken = default)
    {
        long? deletedRevision = null;
        try
        {
            // Read the header first so the change notification can report the last revision before deletion.
            var existing = await _store.LoadAsync(id, cancellationToken).ConfigureAwait(false);
            await _store.DeleteAsync(id, cancellationToken).ConfigureAwait(false);
            _changeLog.Forget(id);
            _mapGates.TryRemove(id, out _);
            if (existing is not null)
                deletedRevision = existing.Revision;
            return Result.Success();
        }
        catch (Exception ex)
        {
            _logger.Error("Mindmap", $"Failed to delete mindmap '{id}'.", ex);
            return Result.Failure($"Failed to delete mindmap '{id}'.", ex);
        }
        finally
        {
            if (deletedRevision is { } rev)
                RaiseChanged(id, rev, MindmapChangeKind.Deleted);
        }
    }

    public async Task<Result<MindmapDocument>> RenameAsync(string id, string title, CancellationToken cancellationToken = default)
    {
        var gate = _mapGates.GetOrAdd(id, _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        long? committedRevision = null;
        try
        {
            var document = await _store.LoadAsync(id, cancellationToken).ConfigureAwait(false);
            if (document is null)
                return Result<MindmapDocument>.Failure($"Mindmap '{id}' was not found.");

            var renamed = document with { Title = title, Revision = document.Revision + 1, ModifiedAt = DateTime.UtcNow };
            // No element text changed, so the FTS mirror needs no delta.
            await _store.SaveAsync(renamed, new MindmapSearchDelta(), cancellationToken).ConfigureAwait(false);
            _changeLog.Record(id, renamed.Revision, new HashSet<string>());
            committedRevision = renamed.Revision;
            return renamed;
        }
        catch (Exception ex)
        {
            _logger.Error("Mindmap", $"Failed to rename mindmap '{id}'.", ex);
            return Result<MindmapDocument>.Failure("Failed to rename mindmap.", ex);
        }
        finally
        {
            // Release before notifying so a slow handler can't hold the per-map write lock.
            gate.Release();
            if (committedRevision is { } rev)
                RaiseChanged(id, rev, MindmapChangeKind.Renamed);
        }
    }

    public async Task<Result<MindmapDocument>> DuplicateAsync(string id, string newTitle, CancellationToken cancellationToken = default)
    {
        (string Id, long Revision)? committed = null;
        try
        {
            var source = await _store.LoadAsync(id, cancellationToken).ConfigureAwait(false);
            if (source is null)
                return Result<MindmapDocument>.Failure($"Mindmap '{id}' was not found.");

            var now = DateTime.UtcNow;
            var working = new MindmapWorkingDocument(Guid.NewGuid().ToString(), newTitle, now, source.Canvas, _idGenerator);

            // Reserve fresh ids for every element and edge (they share the document-local id space).
            var idMap = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (var element in source.Elements)
                idMap[element.Id] = working.NewId();
            foreach (var edge in source.Edges)
                idMap[edge.Id] = working.NewId();

            foreach (var element in source.Elements)
            {
                var content = element.Content is FrameContent frame
                    ? frame with { ChildIds = frame.ChildIds.Select(c => idMap.GetValueOrDefault(c, c)).ToList() }
                    : element.Content;
                working.AddElement(element with { Id = idMap[element.Id], Content = content });
            }

            foreach (var edge in source.Edges)
            {
                working.AddEdge(edge with
                {
                    Id = idMap[edge.Id],
                    FromId = idMap.GetValueOrDefault(edge.FromId, edge.FromId),
                    ToId = idMap.GetValueOrDefault(edge.ToId, edge.ToId),
                }, insertAfterEdgeId: null);
            }

            foreach (var cluster in source.Clusters)
            {
                if (idMap.TryGetValue(cluster.RootId, out var newRoot))
                    working.SetCluster(newRoot, cluster with { RootId = newRoot });
            }

            const long initialRevision = 1;
            var document = working.Materialize(initialRevision, now);
            await _store.SaveAsync(document, working.BuildSearchDelta(fullReplace: true), cancellationToken).ConfigureAwait(false);
            _changeLog.Record(document.Id, initialRevision, working.ChangeTouchedIds);
            committed = (document.Id, initialRevision);
            return document;
        }
        catch (Exception ex)
        {
            _logger.Error("Mindmap", $"Failed to duplicate mindmap '{id}'.", ex);
            return Result<MindmapDocument>.Failure("Failed to duplicate mindmap.", ex);
        }
        finally
        {
            if (committed is { } c)
                RaiseChanged(c.Id, c.Revision, MindmapChangeKind.Created);
        }
    }

    public async Task<Result<IReadOnlyList<MindmapLibraryEntry>>> GetLibraryAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            var entries = await _store.GetLibraryAsync(cancellationToken).ConfigureAwait(false);
            return Result<IReadOnlyList<MindmapLibraryEntry>>.Success(entries);
        }
        catch (Exception ex)
        {
            _logger.Error("Mindmap", "Failed to load mindmap library.", ex);
            return Result<IReadOnlyList<MindmapLibraryEntry>>.Failure("Failed to load mindmap library.", ex);
        }
    }

    public async Task<Result<IReadOnlyList<MindmapFolder>>> GetFoldersAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            var folders = await _store.GetFoldersAsync(cancellationToken).ConfigureAwait(false);
            return Result<IReadOnlyList<MindmapFolder>>.Success(folders);
        }
        catch (Exception ex)
        {
            _logger.Error("Mindmap", "Failed to load mindmap folders.", ex);
            return Result<IReadOnlyList<MindmapFolder>>.Failure("Failed to load mindmap folders.", ex);
        }
    }

    public async Task<Result> SaveFolderAsync(MindmapFolder folder, CancellationToken cancellationToken = default)
    {
        try
        {
            await _store.SaveFolderAsync(folder, cancellationToken).ConfigureAwait(false);
            return Result.Success();
        }
        catch (Exception ex)
        {
            _logger.Error("Mindmap", $"Failed to save mindmap folder '{folder.Id}'.", ex);
            return Result.Failure("Failed to save mindmap folder.", ex);
        }
    }

    public async Task<Result> DeleteFolderAsync(string folderId, CancellationToken cancellationToken = default)
    {
        try
        {
            await _store.DeleteFolderAsync(folderId, cancellationToken).ConfigureAwait(false);
            return Result.Success();
        }
        catch (Exception ex)
        {
            _logger.Error("Mindmap", $"Failed to delete mindmap folder '{folderId}'.", ex);
            return Result.Failure("Failed to delete mindmap folder.", ex);
        }
    }

    public async Task<Result> MoveToFolderAsync(string mapId, string? folderId, CancellationToken cancellationToken = default)
    {
        try
        {
            await _store.SetFolderAsync(mapId, folderId, cancellationToken).ConfigureAwait(false);
            return Result.Success();
        }
        catch (Exception ex)
        {
            _logger.Error("Mindmap", $"Failed to move mindmap '{mapId}'.", ex);
            return Result.Failure("Failed to move mindmap.", ex);
        }
    }

    public async Task<Result<MindmapEditResult>> ApplyAsync(
        string mapId,
        long expectedRevision,
        IReadOnlyList<MindmapEditOp> ops,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(ops);

        var gate = _mapGates.GetOrAdd(mapId, _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        long? committedRevision = null;
        try
        {
            var document = await _store.LoadAsync(mapId, cancellationToken).ConfigureAwait(false);
            if (document is null)
                return Ok(MindmapEditResult.Failure(new MindmapEditError { Code = MindmapEditErrorCode.NotFound, Message = $"Mindmap '{mapId}' was not found." }, expectedRevision));

            if (document.SchemaVersion != 2)
                return Result<MindmapEditResult>.Failure($"Mindmap '{mapId}' uses unsupported schema version {document.SchemaVersion}.");

            document = PruneDanglingEdges(document).Value!;

            var concurrency = CheckRevision(mapId, document.Revision, expectedRevision, ops);
            if (concurrency is not null)
                return Ok(MindmapEditResult.Failure(concurrency, document.Revision));

            var working = new MindmapWorkingDocument(document, _idGenerator);
            var accumulator = new EditAccumulator();

            for (var index = 0; index < ops.Count; index++)
            {
                var error = ApplyOp(working, ops[index], accumulator);
                if (error is not null)
                    return Ok(MindmapEditResult.Failure(error with { FailedOpIndex = index }, document.Revision));
            }

            var newRevision = document.Revision + 1;
            var updated = working.Materialize(newRevision, DateTime.UtcNow);
            await _store.SaveAsync(updated, working.BuildSearchDelta(fullReplace: false), cancellationToken).ConfigureAwait(false);
            _changeLog.Record(mapId, newRevision, working.ChangeTouchedIds);
            committedRevision = newRevision;

            return Ok(new MindmapEditResult
            {
                Success = true,
                Revision = newRevision,
                CreatedIds = accumulator.CreatedIds,
                DeletedCount = accumulator.DeletedCount,
            });
        }
        catch (Exception ex)
        {
            _logger.Error("Mindmap", $"Failed to apply edit batch to mindmap '{mapId}'.", ex);
            return Result<MindmapEditResult>.Failure($"Failed to apply edit batch to mindmap '{mapId}'.", ex);
        }
        finally
        {
            // Release before notifying so a slow handler can't hold the per-map write lock. Only a real
            // commit sets committedRevision, so failed/rebased-conflict batches raise nothing.
            gate.Release();
            if (committedRevision is { } rev)
                RaiseChanged(mapId, rev, MindmapChangeKind.Edited);
        }
    }

    public async Task<Result<long>> RestoreAsync(
        string mapId,
        long expectedRevision,
        MindmapRestoreDelta delta,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(delta);

        var gate = _mapGates.GetOrAdd(mapId, _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        long? committedRevision = null;
        try
        {
            var document = await _store.LoadAsync(mapId, cancellationToken).ConfigureAwait(false);
            if (document is null)
                return Result<long>.Failure($"Mindmap '{mapId}' was not found.");
            if (document.SchemaVersion != 2)
                return Result<long>.Failure($"Mindmap '{mapId}' uses unsupported schema version {document.SchemaVersion}.");

            document = PruneDanglingEdges(document).Value!;

            // Undo/redo restores the local editor's own prior state; a stale revision means someone else
            // wrote in between, so refuse rather than silently clobbering their change.
            if (expectedRevision != document.Revision)
                return Result<long>.Failure($"Cannot restore: revision {expectedRevision} no longer matches the stored revision {document.Revision}.");

            if (delta.IsEmpty)
                return Result<long>.Success(document.Revision);

            var working = new MindmapWorkingDocument(document, _idGenerator);

            // Clear removed rows first, then restore verbatim: elements before edges so an edge's endpoints
            // exist, and remove-then-add on an existing edge keeps document order duplicate-free.
            foreach (var edgeId in delta.RemoveEdgeIds)
                working.RemoveEdge(edgeId);
            foreach (var elementId in delta.RemoveElementIds)
                working.RemoveElement(elementId);

            foreach (var element in delta.Elements)
            {
                if (working.ContainsElement(element.Id))
                    working.ReplaceElement(element);
                else
                    working.AddElement(element);
            }

            foreach (var edge in delta.Edges)
            {
                if (working.TryGetEdge(edge.Id, out _))
                    working.RemoveEdge(edge.Id);
                working.AddEdge(edge, insertAfterEdgeId: null);
            }

            foreach (var cluster in delta.Clusters)
                working.SetCluster(cluster.RootId, cluster);

            var newRevision = document.Revision + 1;
            var updated = working.Materialize(newRevision, DateTime.UtcNow);
            await _store.SaveAsync(updated, working.BuildSearchDelta(fullReplace: false), cancellationToken).ConfigureAwait(false);
            _changeLog.Record(mapId, newRevision, working.ChangeTouchedIds);
            committedRevision = newRevision;
            return Result<long>.Success(newRevision);
        }
        catch (Exception ex)
        {
            _logger.Error("Mindmap", $"Failed to restore mindmap '{mapId}'.", ex);
            return Result<long>.Failure($"Failed to restore mindmap '{mapId}'.", ex);
        }
        finally
        {
            gate.Release();
            if (committedRevision is { } rev)
                RaiseChanged(mapId, rev, MindmapChangeKind.Edited);
        }
    }

    // ---- Concurrency ---------------------------------------------------------------------

    /// <summary>
    /// Returns null when the batch may proceed (matching revision, or a stale-but-non-contending revision
    /// that rebases cleanly), or a <see cref="MindmapEditErrorCode.RevConflict"/> error otherwise.
    /// </summary>
    private MindmapEditError? CheckRevision(string mapId, long currentRevision, long expectedRevision, IReadOnlyList<MindmapEditOp> ops)
    {
        if (expectedRevision == currentRevision)
            return null;

        if (expectedRevision > currentRevision)
            return new MindmapEditError
            {
                Code = MindmapEditErrorCode.RevConflict,
                Message = $"Revision {expectedRevision} is ahead of the stored revision {currentRevision}.",
            };

        var touchedSince = _changeLog.TouchedSince(mapId, expectedRevision);
        if (touchedSince is null)
            return new MindmapEditError
            {
                Code = MindmapEditErrorCode.RevConflict,
                Message = $"Revision {expectedRevision} is too old to rebase; re-read the current document (now at {currentRevision}).",
            };

        var referenced = CollectReferencedIds(ops);
        var contended = referenced.Where(touchedSince.Contains).ToList();
        if (contended.Count > 0)
            return new MindmapEditError
            {
                Code = MindmapEditErrorCode.RevConflict,
                Message = "The edit batch references elements changed since its revision.",
                ContendedIds = contended,
            };

        return null;
    }

    private static HashSet<string> CollectReferencedIds(IReadOnlyList<MindmapEditOp> ops)
    {
        var ids = new HashSet<string>();
        foreach (var op in ops)
        {
            switch (op)
            {
                case AddNodesOp add:
                    AddIfPresent(ids, add.Under);
                    AddIfPresent(ids, add.After);
                    break;
                case SetOp set:
                    ids.Add(set.Id);
                    break;
                case MoveOp move:
                    ids.Add(move.Id);
                    AddIfPresent(ids, move.Under);
                    AddIfPresent(ids, move.After);
                    break;
                case DeleteOp del:
                    foreach (var id in del.Ids)
                        ids.Add(id);
                    break;
                case LinkOp link:
                    ids.Add(link.A);
                    ids.Add(link.B);
                    break;
                case UnlinkOp unlink:
                    AddIfPresent(ids, unlink.EdgeId);
                    AddIfPresent(ids, unlink.A);
                    AddIfPresent(ids, unlink.B);
                    break;
                case StyleSubtreeOp style:
                    AddIfPresent(ids, style.Root);
                    if (style.Ids is not null)
                        foreach (var id in style.Ids)
                            ids.Add(id);
                    break;
                case LayoutOp layout:
                    AddIfPresent(ids, layout.Root);
                    break;
                case FrameOp frame:
                    ids.Add(frame.Id);
                    if (frame.Add is not null)
                        foreach (var id in frame.Add)
                            ids.Add(id);
                    if (frame.Remove is not null)
                        foreach (var id in frame.Remove)
                            ids.Add(id);
                    break;
            }
        }

        return ids;
    }

    private static void AddIfPresent(HashSet<string> ids, string? id)
    {
        if (id is not null)
            ids.Add(id);
    }

    // ---- Op dispatch ----------------------------------------------------------------------------

    private MindmapEditError? ApplyOp(MindmapWorkingDocument working, MindmapEditOp op, EditAccumulator accumulator) => op switch
    {
        AddNodesOp add => ApplyAddNodes(working, add, accumulator),
        SetOp set => ApplySet(working, set),
        MoveOp move => ApplyMove(working, move),
        DeleteOp del => ApplyDelete(working, del, accumulator),
        LinkOp link => ApplyLink(working, link, accumulator),
        UnlinkOp unlink => ApplyUnlink(working, unlink),
        SetEdgeOp setEdge => ApplySetEdge(working, setEdge),
        StyleSubtreeOp style => ApplyStyleSubtree(working, style),
        LayoutOp layout => ApplyLayout(working, layout),
        AddElementOp addElement => ApplyAddElement(working, addElement, accumulator),
        FrameOp frame => ApplyFrame(working, frame),
        _ => Err(MindmapEditErrorCode.InvalidOperation, $"Unknown edit op '{op.GetType().Name}'."),
    };

    private MindmapEditError? ApplyAddNodes(MindmapWorkingDocument working, AddNodesOp op, EditAccumulator accumulator)
    {
        if (op.Nodes is null || op.Nodes.Count == 0)
            return Err(MindmapEditErrorCode.InvalidOperation, "add requires at least one node.");

        if (op.Under is not null)
        {
            if (!working.TryGetElement(op.Under, out var parent))
                return NotFound(working, op.Under);
            if (parent.Kind != ElementKind.Node)
                return Err(MindmapEditErrorCode.BadContentType, $"'{op.Under}' is not a node and cannot be a hierarchy parent.");
        }

        string? afterEdge;
        if (op.Under is not null)
        {
            var resolved = ResolveAfterEdge(working, op.Under, op.After, out afterEdge);
            if (resolved is not null)
                return resolved;
        }
        else
        {
            afterEdge = null;
        }

        foreach (var spec in op.Nodes)
        {
            var error = CreateNodeTree(working, spec, op.Under, afterEdge, accumulator, out var createdEdgeId);
            if (error is not null)
                return error;
            afterEdge = createdEdgeId ?? afterEdge;
        }

        return null;
    }

    private MindmapEditError? CreateNodeTree(
        MindmapWorkingDocument working, MindmapNodeSpec spec, string? parentId, string? afterEdgeId, EditAccumulator accumulator, out string? createdEdgeId)
    {
        createdEdgeId = null;

        var content = spec.Content ?? new TextContent { Text = spec.Text ?? string.Empty };
        if (!IsNodeContent(content))
            return Err(MindmapEditErrorCode.BadContentType, $"Content '{content.TypeDiscriminator}' is not valid for a node (use add_el for shapes/text/images/frames).");

        var pinned = spec.X.HasValue && spec.Y.HasValue;
        var id = working.NewId();
        working.AddElement(new MindmapElement
        {
            Id = id,
            Kind = ElementKind.Node,
            Content = content,
            X = spec.X ?? 0,
            Y = spec.Y ?? 0,
            Pinned = pinned,
        });

        if (spec.Ref is not null)
            accumulator.CreatedIds[spec.Ref] = id;

        if (parentId is not null)
        {
            createdEdgeId = working.NewId();
            working.AddEdge(new MindmapEdge { Id = createdEdgeId, FromId = parentId, ToId = id, Kind = EdgeKind.Hierarchy }, afterEdgeId);
        }

        string? childAfter = null;
        foreach (var child in spec.Children)
        {
            var error = CreateNodeTree(working, child, id, childAfter, accumulator, out var childEdgeId);
            if (error is not null)
                return error;
            childAfter = childEdgeId ?? childAfter;
        }

        return null;
    }

    private static MindmapEditError? ApplySet(MindmapWorkingDocument working, SetOp op)
    {
        if (!working.TryGetElement(op.Id, out var element))
            return NotFound(working, op.Id);

        var updated = element;

        if (op.Content is not null)
        {
            if (!ContentMatchesKind(element.Kind, op.Content))
                return Err(MindmapEditErrorCode.BadContentType, $"Content '{op.Content.TypeDiscriminator}' does not match element kind {element.Kind}.");
            updated = updated with { Content = op.Content };
        }
        else if (op.Text is not null)
        {
            var textContent = BuildTextContent(element, op.Text);
            if (textContent is null)
                return Err(MindmapEditErrorCode.BadContentType, $"Element kind {element.Kind} has no text slot for the 't' shorthand.");
            updated = updated with { Content = textContent };
        }

        if (op.ClearStyle)
            updated = updated with { Style = op.Style is null ? null : MergeStyle(null, op.Style) };
        else if (op.Style is not null)
            updated = updated with { Style = MergeStyle(element.Style, op.Style) };
        if (op.Collapsed.HasValue)
            updated = updated with { Collapsed = op.Collapsed.Value };
        if (op.Pinned.HasValue)
            updated = updated with { Pinned = op.Pinned.Value };
        if (op.Width.HasValue)
            updated = updated with { Width = op.Width.Value };
        if (op.Height.HasValue)
            updated = updated with { Height = op.Height.Value };

        working.ReplaceElement(updated);
        return null;
    }

    private static MindmapEditError? ApplyMove(MindmapWorkingDocument working, MoveOp op)
    {
        if (!working.TryGetElement(op.Id, out var element))
            return NotFound(working, op.Id);

        if (op.X.HasValue && op.Y.HasValue)
        {
            var dx = op.X.Value - element.X;
            var dy = op.Y.Value - element.Y;

            working.ReplaceElement(element with
            {
                X = op.X.Value,
                Y = op.Y.Value,
                Pinned = element.Kind == ElementKind.Node ? true : element.Pinned,
            });

            // Moving a frame translates its members by the same delta so the group moves together
            // Member nodes pin, matching the "reposition implies pin" rule
            // above — otherwise the next auto-layout would snap them back and split the group.
            if ((dx != 0 || dy != 0) && element.Content is FrameContent frame)
                TranslateFrameMembers(working, frame, dx, dy);

            return null;
        }

        if (op.Under is null)
            return Err(MindmapEditErrorCode.InvalidOperation, "move requires either a position (x, y) or a new parent (under).");

        if (element.Kind != ElementKind.Node)
            return Err(MindmapEditErrorCode.BadContentType, "Only nodes can be reparented.");
        if (!working.TryGetElement(op.Under, out var parent))
            return NotFound(working, op.Under);
        if (parent.Kind != ElementKind.Node)
            return Err(MindmapEditErrorCode.BadContentType, $"'{op.Under}' is not a node and cannot be a hierarchy parent.");
        if (MindmapGraph.WouldCreateCycle(working.Edges, op.Under, op.Id))
            return Err(MindmapEditErrorCode.WouldCycle, $"Reparenting '{op.Id}' under '{op.Under}' would create a cycle.");

        var resolved = ResolveAfterEdge(working, op.Under, op.After, out var afterEdge);
        if (resolved is not null)
            return resolved;

        var existingParent = MindmapGraph.HierarchyParentEdge(working.Edges, op.Id);
        if (existingParent is not null)
            working.RemoveEdge(existingParent.Id);

        var edgeId = working.NewId();
        working.AddEdge(new MindmapEdge { Id = edgeId, FromId = op.Under, ToId = op.Id, Kind = EdgeKind.Hierarchy }, afterEdge);
        return null;
    }

    private static MindmapEditError? ApplyDelete(MindmapWorkingDocument working, DeleteOp op, EditAccumulator accumulator)
    {
        if (op.Ids is null || op.Ids.Count == 0)
            return Err(MindmapEditErrorCode.InvalidOperation, "del requires at least one id.");

        var toRemove = new HashSet<string>();
        foreach (var id in op.Ids)
        {
            if (!working.ContainsElement(id))
                return NotFound(working, id);
            toRemove.UnionWith(MindmapGraph.CollectSubtree(working.Edges, id));
        }

        // Collect incident edges before removing elements.
        var edgesToRemove = new HashSet<string>();
        foreach (var elementId in toRemove)
            foreach (var edge in working.IncidentEdges(elementId))
                edgesToRemove.Add(edge.Id);

        foreach (var edgeId in edgesToRemove)
            working.RemoveEdge(edgeId);
        foreach (var elementId in toRemove)
            working.RemoveElement(elementId);

        // Frames orphan (never cascade) their members, but a deleted member must not linger as a dangling
        // ChildId — drop removed ids from any surviving frame's membership.
        PruneFrameMembership(working, toRemove);

        accumulator.DeletedCount += toRemove.Count;
        return null;
    }

    private static MindmapEditError? ApplyLink(MindmapWorkingDocument working, LinkOp op, EditAccumulator accumulator)
    {
        if (op.A == op.B)
            return Err(MindmapEditErrorCode.InvalidOperation, "A link edge must join two different elements.");
        if (!working.ContainsElement(op.A))
            return NotFound(working, op.A);
        if (!working.ContainsElement(op.B))
            return NotFound(working, op.B);

        var edgeId = working.NewId();
        working.AddEdge(new MindmapEdge
        {
            Id = edgeId,
            FromId = op.A,
            ToId = op.B,
            Kind = EdgeKind.Link,
            Label = op.Label,
            Style = op.Style,
        }, insertAfterEdgeId: null);

        if (op.Ref is not null)
            accumulator.CreatedIds[op.Ref] = edgeId;
        return null;
    }

    private static MindmapEditError? ApplyUnlink(MindmapWorkingDocument working, UnlinkOp op)
    {
        MindmapEdge? target;
        if (op.EdgeId is not null)
        {
            if (!working.TryGetEdge(op.EdgeId, out target))
                return NotFound(working, op.EdgeId);
        }
        else if (op.A is not null && op.B is not null)
        {
            target = working.FindEdge(e => e.FromId == op.A && e.ToId == op.B);
            if (target is null)
                return Err(MindmapEditErrorCode.NotFound, $"No edge from '{op.A}' to '{op.B}'.");
        }
        else
        {
            return Err(MindmapEditErrorCode.InvalidOperation, "unlink requires an edge id or both endpoints (a, b).");
        }

        working.RemoveEdge(target.Id);
        return null;
    }

    private static MindmapEditError? ApplySetEdge(MindmapWorkingDocument working, SetEdgeOp op)
    {
        if (!working.TryGetEdge(op.EdgeId, out var edge))
            return NotFound(working, op.EdgeId);

        var updated = edge;
        if (op.Label is not null)
            updated = updated with { Label = op.Label.Length == 0 ? null : op.Label };

        if (op.ClearStyle)
            updated = updated with { Style = op.Style is null ? null : MergeEdgeStyle(null, op.Style) };
        else if (op.Style is not null)
            updated = updated with { Style = MergeEdgeStyle(edge.Style, op.Style) };

        working.ReplaceEdge(updated);
        return null;
    }

    private static MindmapEditError? ApplyStyleSubtree(MindmapWorkingDocument working, StyleSubtreeOp op)
    {
        IReadOnlyCollection<string> targets;
        if (op.Root is not null)
        {
            if (!working.ContainsElement(op.Root))
                return NotFound(working, op.Root);
            targets = MindmapGraph.CollectSubtree(working.Edges, op.Root);
        }
        else if (op.Ids is { Count: > 0 })
        {
            foreach (var id in op.Ids)
                if (!working.ContainsElement(id))
                    return NotFound(working, id);
            targets = op.Ids;
        }
        else
        {
            return Err(MindmapEditErrorCode.InvalidOperation, "style_subtree requires a root or an id list.");
        }

        foreach (var id in targets)
        {
            working.TryGetElement(id, out var element);
            working.ReplaceElement(element with { Style = MergeStyle(element.Style, op.Style) });
        }

        return null;
    }

    private static MindmapEditError? ApplyLayout(MindmapWorkingDocument working, LayoutOp op)
    {
        if (op.Root is not null)
        {
            if (!working.ContainsElement(op.Root))
                return NotFound(working, op.Root);

            var existing = working.GetOrDefaultCluster(op.Root);
            working.SetCluster(op.Root, existing with
            {
                LayoutAlgorithm = op.Algorithm ?? existing.LayoutAlgorithm,
                TemplateId = op.TemplateId ?? existing.TemplateId,
                Options = op.Options ?? existing.Options,
            });
            return null;
        }

        if (op.Algorithm is not null)
            return Err(MindmapEditErrorCode.InvalidOperation, "A document-level layout requires a root; only defaults apply document-wide.");

        if (op.TemplateId is not null)
            working.SetCanvas(working.Canvas with { DefaultTemplateId = op.TemplateId });

        if (op.Background is not null)
            working.SetCanvas(working.Canvas with { Background = op.Background.Value });

        // Merged rather than replaced, matching how Set and SetEdge treat a style: picking a branch
        // material should not silently clear the edge colour chosen beside it.
        if (op.EdgeDefaults is not null)
            working.SetCanvas(working.Canvas with { EdgeDefaults = MergeEdgeStyle(working.Canvas.EdgeDefaults, op.EdgeDefaults) });

        return null;
    }

    private static MindmapEditError? ApplyAddElement(MindmapWorkingDocument working, AddElementOp op, EditAccumulator accumulator)
    {
        if (op.Kind == ElementKind.Node)
            return Err(MindmapEditErrorCode.BadContentType, "add_el creates free elements; use add for nodes.");
        if (!ContentMatchesKind(op.Kind, op.Content))
            return Err(MindmapEditErrorCode.BadContentType, $"Content '{op.Content.TypeDiscriminator}' does not match element kind {op.Kind}.");

        if (op.Content is FrameContent frame)
        {
            foreach (var childId in frame.ChildIds)
            {
                if (!working.TryGetElement(childId, out var child))
                    return NotFound(working, childId);
                if (child.Kind == ElementKind.Frame)
                    return Err(MindmapEditErrorCode.BadContentType, "Frames may not contain frames.");
            }
        }

        var id = working.NewId();
        working.AddElement(new MindmapElement
        {
            Id = id,
            Kind = op.Kind,
            Content = op.Content,
            X = op.X,
            Y = op.Y,
            Width = op.Width,
            Height = op.Height,
        });

        if (op.Ref is not null)
            accumulator.CreatedIds[op.Ref] = id;
        return null;
    }

    private static MindmapEditError? ApplyFrame(MindmapWorkingDocument working, FrameOp op)
    {
        if (!working.TryGetElement(op.Id, out var element))
            return NotFound(working, op.Id);
        if (element.Content is not FrameContent frame)
            return Err(MindmapEditErrorCode.BadContentType, $"Element '{op.Id}' is not a frame.");

        var members = new List<string>(frame.ChildIds);

        if (op.Remove is not null)
            members.RemoveAll(op.Remove.Contains);

        if (op.Add is not null)
        {
            foreach (var childId in op.Add)
            {
                if (childId == op.Id)
                    return Err(MindmapEditErrorCode.InvalidOperation, "A frame cannot contain itself.");
                if (!working.TryGetElement(childId, out var child))
                    return NotFound(working, childId);
                if (child.Kind == ElementKind.Frame)
                    return Err(MindmapEditErrorCode.BadContentType, "Frames may not contain frames.");
                if (!members.Contains(childId))
                    members.Add(childId);
            }
        }

        working.ReplaceElement(element with { Content = frame with { ChildIds = members } });
        return null;
    }

    // ---- Helpers --------------------------------------------------------------------------------

    private static void TranslateFrameMembers(MindmapWorkingDocument working, FrameContent frame, double dx, double dy)
    {
        foreach (var childId in frame.ChildIds)
        {
            if (!working.TryGetElement(childId, out var child))
                continue;
            working.ReplaceElement(child with
            {
                X = child.X + dx,
                Y = child.Y + dy,
                Pinned = child.Kind == ElementKind.Node ? true : child.Pinned,
            });
        }
    }

    private static void PruneFrameMembership(MindmapWorkingDocument working, IReadOnlyCollection<string> removedIds)
    {
        foreach (var element in working.Elements.ToList())
        {
            if (element.Content is not FrameContent frame)
                continue;

            if (!frame.ChildIds.Any(removedIds.Contains))
                continue;

            var remaining = frame.ChildIds.Where(id => !removedIds.Contains(id)).ToList();
            working.ReplaceElement(element with { Content = frame with { ChildIds = remaining } });
        }
    }

    /// <summary>Resolves the <c>after</c> sibling to the hierarchy edge to insert past, or an error.</summary>
    private static MindmapEditError? ResolveAfterEdge(MindmapWorkingDocument working, string parentId, string? afterSiblingId, out string? afterEdgeId)
    {
        afterEdgeId = null;
        if (afterSiblingId is null)
            return null;

        var edge = working.FindEdge(e => e.Kind == EdgeKind.Hierarchy && e.FromId == parentId && e.ToId == afterSiblingId);
        if (edge is null)
            return Err(MindmapEditErrorCode.NotFound, $"'{afterSiblingId}' is not a child of '{parentId}'.");

        afterEdgeId = edge.Id;
        return null;
    }

    private static Result<MindmapDocument> PruneDanglingEdges(MindmapDocument document)
    {
        var elementIds = document.Elements.Select(e => e.Id).ToHashSet();
        var kept = document.Edges.Where(e => elementIds.Contains(e.FromId) && elementIds.Contains(e.ToId)).ToList();
        if (kept.Count == document.Edges.Count)
            return document;

        return document with { Edges = kept };
    }

    private static IEnumerable<string> RootNodeIds(MindmapWorkingDocument working)
    {
        var withParent = working.Edges
            .Where(e => e.Kind == EdgeKind.Hierarchy)
            .Select(e => e.ToId)
            .ToHashSet();

        return working.Elements
            .Where(e => e.Kind == ElementKind.Node && !withParent.Contains(e.Id))
            .Select(e => e.Id)
            .ToList();
    }

    private static Dictionary<string, string> BuildHierarchyParentMap(MindmapDocument document)
    {
        var parentOf = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var edge in document.Edges)
        {
            if (edge.Kind == EdgeKind.Hierarchy)
                parentOf[edge.ToId] = edge.FromId;
        }

        return parentOf;
    }

    /// <summary>Ancestor node texts from root to the element's parent, joined with " &gt; " (empty for roots/free elements).</summary>
    private static string BuildHierarchyPath(
        string elementId,
        IReadOnlyDictionary<string, string> parentOf,
        IReadOnlyDictionary<string, MindmapElement> byId)
    {
        var ancestors = new List<string>();
        // Track visited (starting from the hit itself) so a malformed cycle can never spin here.
        var visited = new HashSet<string>(StringComparer.Ordinal) { elementId };
        var current = elementId;
        while (parentOf.TryGetValue(current, out var parent) && visited.Add(parent))
        {
            if (byId.TryGetValue(parent, out var parentElement))
            {
                var text = MindmapSearchText.Extract(parentElement);
                ancestors.Add(string.IsNullOrEmpty(text) ? parent : text);
            }

            current = parent;
        }

        ancestors.Reverse();
        return string.Join(" > ", ancestors);
    }

    private void RaiseChanged(string mapId, long revision, MindmapChangeKind kind)
    {
        var handler = Changed;
        if (handler is null)
            return;

        try
        {
            handler(this, new MindmapChangedEventArgs { MapId = mapId, Revision = revision, Kind = kind });
        }
        catch (Exception ex)
        {
            // The notification is a boundary: a subscriber throwing must not roll back the committed write
            // or surface as a service failure. Log and continue.
            _logger.Error("Mindmap", $"A mindmap change handler threw for '{mapId}'.", ex);
        }
    }

    private static IElementContent? BuildTextContent(MindmapElement element, string text) => element.Kind switch
    {
        // Write the text into the node's own kind so editing a task/code/math label keeps its type
        // (Done, Language, ...) instead of silently reverting the node to plain text.
        ElementKind.Node => element.Content switch
        {
            TaskContent task => task with { Text = text },
            CodeContent code => code with { Source = text },
            MathContent math => math with { Latex = text },
            LinkContent link => link with { Title = text },
            _ => new TextContent { Text = text },
        },
        ElementKind.Text => new FreeTextContent { Text = text },
        ElementKind.Shape when element.Content is ShapeContent shape => shape with { Text = text },
        ElementKind.Frame when element.Content is FrameContent frame => frame with { Title = text },
        _ => null,
    };

    private static bool IsNodeContent(IElementContent content) => content is
        TextContent or ImageContent or LinkContent or FlashcardContent or
        NoteContent or TaskContent or CodeContent or MathContent or PlaceholderContent;

    private static bool ContentMatchesKind(ElementKind kind, IElementContent content) => content is PlaceholderContent || kind switch
    {
        ElementKind.Node => IsNodeContent(content),
        ElementKind.Shape => content is ShapeContent,
        ElementKind.Text => content is FreeTextContent,
        ElementKind.Image => content is CanvasImageContent,
        ElementKind.Frame => content is FrameContent,
        _ => false,
    };

    private static ElementStyle MergeStyle(ElementStyle? existing, ElementStyle incoming)
    {
        if (existing is null)
            return incoming;

        return new ElementStyle
        {
            Fill = incoming.Fill ?? existing.Fill,
            Stroke = incoming.Stroke ?? existing.Stroke,
            TextColor = incoming.TextColor ?? existing.TextColor,
            FontScale = incoming.FontScale ?? existing.FontScale,
            NodeShape = incoming.NodeShape ?? existing.NodeShape,
            Icon = incoming.Icon ?? existing.Icon,
        };
    }

    private static EdgeStyle MergeEdgeStyle(EdgeStyle? existing, EdgeStyle incoming)
    {
        if (existing is null)
            return incoming;

        return new EdgeStyle
        {
            Line = incoming.Line ?? existing.Line,
            WidthProfile = incoming.WidthProfile ?? existing.WidthProfile,
            Routing = incoming.Routing ?? existing.Routing,
            StartCap = incoming.StartCap ?? existing.StartCap,
            EndCap = incoming.EndCap ?? existing.EndCap,
            Color = incoming.Color ?? existing.Color,
            Thickness = incoming.Thickness ?? existing.Thickness,
        };
    }

    // A mistyped short id gets nearest-text suggestions ranked against the document's live elements, so a
    // small model can recover without re-reading the whole map.
    private static MindmapEditError NotFound(MindmapWorkingDocument working, string id) =>
        new()
        {
            Code = MindmapEditErrorCode.NotFound,
            Message = $"Element or edge '{id}' was not found.",
            Suggestions = MindmapSuggestions.NearestElementIds(working.Elements, id),
        };

    private static MindmapEditError Err(MindmapEditErrorCode code, string message) =>
        new() { Code = code, Message = message };

    private static Result<MindmapEditResult> Ok(MindmapEditResult result) => Result<MindmapEditResult>.Success(result);

    private sealed class EditAccumulator
    {
        public Dictionary<string, string> CreatedIds { get; } = new();

        public int DeletedCount { get; set; }
    }
}
