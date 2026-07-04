using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Mindmap;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Services;

public class MindmapService : IMindmapService
{
    private readonly IStorageProvider _storage;
    private readonly ILoggerService _logger;
    private const string MindmapListKey = "mindmaps_list";
    private const string MindmapPrefix = "mindmap_";

    public MindmapService(IStorageProvider storage, ILoggerService logger)
    {
        _storage = storage;
        _logger = logger;
    }

    public async Task<Result<IEnumerable<Mindmap>>> GetAllMindmapsAsync()
    {
        try
        {
            var listResult = await _storage.LoadAsync<List<string>>(MindmapListKey).ConfigureAwait(false);
            if (!listResult.IsSuccess || listResult.Value == null)
            {
                return Result<IEnumerable<Mindmap>>.Success(Enumerable.Empty<Mindmap>());
            }

            var mindmaps = new List<Mindmap>();
            var tasks = listResult.Value.Select(GetMindmapAsync);
            var results = await Task.WhenAll(tasks).ConfigureAwait(false);

            foreach (var mapResult in results)
            {
                if (mapResult.IsSuccess && mapResult.Value != null)
                {
                    mindmaps.Add(mapResult.Value);
                }
            }

            return Result<IEnumerable<Mindmap>>.Success(mindmaps);
        }
        catch (Exception ex)
        {
            _logger.Error("MindmapService", "Failed to get all mindmaps", ex);
            return Result<IEnumerable<Mindmap>>.Failure("Failed to get all mindmaps", ex);
        }
    }

    public async Task<Result<Mindmap>> GetMindmapAsync(string id)
    {
        try
        {
            var result = await _storage.LoadAsync<Mindmap>(MindmapPrefix + id).ConfigureAwait(false);
            if (!result.IsSuccess || result.Value == null)
            {
                return Result<Mindmap>.Failure($"Mindmap with id {id} not found");
            }

            // Version migration logic would go here
            if (result.Value.Version < 1)
            {
                // Migrate...
                result.Value.Version = 1;
            }

            return Result<Mindmap>.Success(result.Value);
        }
        catch (Exception ex)
        {
            _logger.Error("MindmapService", $"Failed to get mindmap {id}", ex);
            return Result<Mindmap>.Failure($"Failed to get mindmap {id}", ex);
        }
    }

    public async Task<Result<Mindmap>> CreateMindmapAsync(string title)
    {
        try
        {
            var mindmap = new Mindmap
            {
                Id = Guid.NewGuid().ToString(),
                Title = title,
                Version = 1
            };

            // Create root node
            var rootNode = new MindmapNode
            {
                Id = Guid.NewGuid().ToString(),
                NodeType = "text",
                Content = new TextNodeContent { Text = title }
            };
            mindmap.Nodes.Add(rootNode);
            mindmap.RootNodeId = rootNode.Id;
            mindmap.Layout.Nodes[rootNode.Id] = new NodeLayout { X = 400, Y = 300 };

            var saveResult = await SaveMindmapAsync(mindmap).ConfigureAwait(false);
            if (!saveResult.IsSuccess) return Result<Mindmap>.Failure(saveResult.ErrorMessage!);

            // Update index
            var listResult = await _storage.LoadAsync<List<string>>(MindmapListKey).ConfigureAwait(false);
            var list = listResult.Value ?? new List<string>();
            if (!list.Contains(mindmap.Id))
            {
                list.Add(mindmap.Id);
                await _storage.SaveAsync(MindmapListKey, list).ConfigureAwait(false);
            }

            return Result<Mindmap>.Success(mindmap);
        }
        catch (Exception ex)
        {
            _logger.Error("MindmapService", "Failed to create mindmap", ex);
            return Result<Mindmap>.Failure("Failed to create mindmap", ex);
        }
    }

    public async Task<Result> SaveMindmapAsync(Mindmap mindmap)
    {
        mindmap.ModifiedAt = DateTime.UtcNow;

        var saveResult = await _storage.SaveAsync(MindmapPrefix + mindmap.Id, mindmap).ConfigureAwait(false);
        if (!saveResult.IsSuccess)
            return saveResult;

        // Keep the index in sync so mindmaps saved via import are visible in overview.
        var listResult = await _storage.LoadAsync<List<string>>(MindmapListKey).ConfigureAwait(false);
        var list = listResult.Value ?? new List<string>();
        if (!list.Contains(mindmap.Id))
        {
            list.Add(mindmap.Id);
            var listSave = await _storage.SaveAsync(MindmapListKey, list).ConfigureAwait(false);
            if (!listSave.IsSuccess)
                return listSave;
        }

        return Result.Success();
    }

    public async Task<Result> DeleteMindmapAsync(string id)
    {
        try
        {
            await _storage.DeleteAsync(MindmapPrefix + id).ConfigureAwait(false);
            
            var listResult = await _storage.LoadAsync<List<string>>(MindmapListKey).ConfigureAwait(false);
            if (listResult.IsSuccess && listResult.Value != null)
            {
                listResult.Value.Remove(id);
                await _storage.SaveAsync(MindmapListKey, listResult.Value).ConfigureAwait(false);
            }
            
            return Result.Success();
        }
        catch (Exception ex)
        {
            _logger.Error("MindmapService", $"Failed to delete mindmap {id}", ex);
            return Result.Failure($"Failed to delete mindmap {id}", ex);
        }
    }

    public async Task<Result<MindmapNode>> AddNodeAsync(string mindmapId, string nodeType, IMindmapNodeContent content, double x, double y)
    {
        var mapResult = await GetMindmapAsync(mindmapId).ConfigureAwait(false);
        if (!mapResult.IsSuccess) return Result<MindmapNode>.Failure(mapResult.ErrorMessage!);

        var mindmap = mapResult.Value!;
        var node = new MindmapNode
        {
            Id = Guid.NewGuid().ToString(),
            NodeType = nodeType,
            Content = content
        };

        mindmap.Nodes.Add(node);
        mindmap.Layout.Nodes[node.Id] = new NodeLayout { X = x, Y = y };

        await SaveMindmapAsync(mindmap).ConfigureAwait(false);
        return Result<MindmapNode>.Success(node);
    }

    public async Task<Result> RemoveNodeAsync(string mindmapId, string nodeId)
    {
        var mapResult = await GetMindmapAsync(mindmapId).ConfigureAwait(false);
        if (!mapResult.IsSuccess) return Result.Failure(mapResult.ErrorMessage!);

        var mindmap = mapResult.Value!;
        var node = mindmap.Nodes.FirstOrDefault(n => n.Id == nodeId);
        if (node == null) return Result.Failure("Node not found");

        mindmap.Nodes.Remove(node);
        mindmap.Edges.RemoveAll(e => e.FromId == nodeId || e.ToId == nodeId);
        mindmap.Layout.Nodes.Remove(nodeId);

        if (mindmap.RootNodeId == nodeId) mindmap.RootNodeId = null;

        return await SaveMindmapAsync(mindmap).ConfigureAwait(false);
    }

    public async Task<Result<MindmapEdge>> AddEdgeAsync(string mindmapId, string fromId, string toId, MindmapEdgeKind kind, string? label = null, string? type = null)
    {
        var mapResult = await GetMindmapAsync(mindmapId).ConfigureAwait(false);
        if (!mapResult.IsSuccess) return Result<MindmapEdge>.Failure(mapResult.ErrorMessage!);

        var mindmap = mapResult.Value!;

        if (mindmap.Nodes.All(n => n.Id != fromId))
            return Result<MindmapEdge>.Failure($"Node '{fromId}' not found in mindmap.");
        if (mindmap.Nodes.All(n => n.Id != toId))
            return Result<MindmapEdge>.Failure($"Node '{toId}' not found in mindmap.");

        var existingSame = mindmap.Edges.FirstOrDefault(e =>
            e.FromId == fromId && e.ToId == toId && e.Kind == kind);
        if (existingSame != null)
            return Result<MindmapEdge>.Success(existingSame);
        
        if (kind == MindmapEdgeKind.Hierarchy && WouldCreateCycle(mindmap, fromId, toId))
        {
            return Result<MindmapEdge>.Failure("Cannot add hierarchy edge: would create a cycle");
        }

        var edge = new MindmapEdge
        {
            Id = Guid.NewGuid().ToString(),
            FromId = fromId,
            ToId = toId,
            Kind = kind,
            Type = type ?? EdgeTypes.Solid,
            Label = label
        };

        mindmap.Edges.Add(edge);
        await SaveMindmapAsync(mindmap).ConfigureAwait(false);
        return Result<MindmapEdge>.Success(edge);
    }

    public async Task<Result> RemoveEdgeAsync(string mindmapId, string edgeId)
    {
        var mapResult = await GetMindmapAsync(mindmapId).ConfigureAwait(false);
        if (!mapResult.IsSuccess) return Result.Failure(mapResult.ErrorMessage!);

        var mindmap = mapResult.Value!;
        var edge = mindmap.Edges.FirstOrDefault(e => e.Id == edgeId);
        if (edge == null) return Result.Failure("Edge not found");

        mindmap.Edges.Remove(edge);
        return await SaveMindmapAsync(mindmap).ConfigureAwait(false);
    }

    public async Task<Result> UpdateEdgeLabelAsync(string mindmapId, string edgeId, string? label)
    {
        var mapResult = await GetMindmapAsync(mindmapId).ConfigureAwait(false);
        if (!mapResult.IsSuccess) return Result.Failure(mapResult.ErrorMessage!);

        var mindmap = mapResult.Value!;
        var edge = mindmap.Edges.FirstOrDefault(e => e.Id == edgeId);
        if (edge == null) return Result.Failure("Edge not found");

        edge.Label = label;
        return await SaveMindmapAsync(mindmap).ConfigureAwait(false);
    }

    public async Task<Result> UpdateEdgeKindAsync(string mindmapId, string edgeId, MindmapEdgeKind kind)
    {
        var mapResult = await GetMindmapAsync(mindmapId).ConfigureAwait(false);
        if (!mapResult.IsSuccess) return Result.Failure(mapResult.ErrorMessage!);

        var mindmap = mapResult.Value!;
        var edge = mindmap.Edges.FirstOrDefault(e => e.Id == edgeId);
        if (edge == null) return Result.Failure("Edge not found");

        if (kind == MindmapEdgeKind.Hierarchy && WouldCreateCycle(mindmap, edge.FromId, edge.ToId))
            return Result.Failure("Cannot set hierarchy: would create a cycle");

        edge.Kind = kind;
        return await SaveMindmapAsync(mindmap).ConfigureAwait(false);
    }

    public async Task<Result> UpdateEdgeTypeAsync(string mindmapId, string edgeId, string type)
    {
        var mapResult = await GetMindmapAsync(mindmapId).ConfigureAwait(false);
        if (!mapResult.IsSuccess) return Result.Failure(mapResult.ErrorMessage!);

        var mindmap = mapResult.Value!;
        var edge = mindmap.Edges.FirstOrDefault(e => e.Id == edgeId);
        if (edge == null) return Result.Failure("Edge not found");

        edge.Type = type;
        return await SaveMindmapAsync(mindmap).ConfigureAwait(false);
    }

    public async Task<Result> UpdateNodeContentAsync(string mindmapId, string nodeId, IMindmapNodeContent content)
    {
        var mapResult = await GetMindmapAsync(mindmapId).ConfigureAwait(false);
        if (!mapResult.IsSuccess) return Result.Failure(mapResult.ErrorMessage!);

        var mindmap = mapResult.Value!;
        var node = mindmap.Nodes.FirstOrDefault(n => n.Id == nodeId);
        if (node == null) return Result.Failure("Node not found");

        node.Content = content;
        return await SaveMindmapAsync(mindmap).ConfigureAwait(false);
    }

    public async Task<Result> UpdateNodeLayoutAsync(string mindmapId, string nodeId, double x, double y, double? width = null, double? height = null)
    {
        var mapResult = await GetMindmapAsync(mindmapId).ConfigureAwait(false);
        if (!mapResult.IsSuccess) return Result.Failure(mapResult.ErrorMessage!);

        var mindmap = mapResult.Value!;
        if (!mindmap.Layout.Nodes.TryGetValue(nodeId, out var layout))
        {
            layout = new NodeLayout();
            mindmap.Layout.Nodes[nodeId] = layout;
        }

        layout.X = x;
        layout.Y = y;
        if (width.HasValue) layout.Width = width;
        if (height.HasValue) layout.Height = height;

        return await SaveMindmapAsync(mindmap).ConfigureAwait(false);
    }

    public async Task<Result> UpdateNodeStyleAsync(string mindmapId, string nodeId, IReadOnlyDictionary<string, string?> styleUpdates)
    {
        var mapResult = await GetMindmapAsync(mindmapId).ConfigureAwait(false);
        if (!mapResult.IsSuccess) return Result.Failure(mapResult.ErrorMessage!);

        var mindmap = mapResult.Value!;
        var node = mindmap.Nodes.FirstOrDefault(n => n.Id == nodeId);
        if (node == null) return Result.Failure("Node not found");

        foreach (var kv in styleUpdates)
        {
            if (kv.Value == null)
                node.Style.Remove(kv.Key);
            else
                node.Style[kv.Key] = kv.Value;
        }

        return await SaveMindmapAsync(mindmap).ConfigureAwait(false);
    }

    public async Task<Result> UpdateLayoutAlgorithmAsync(string mindmapId, string algorithm)
    {
        var mapResult = await GetMindmapAsync(mindmapId).ConfigureAwait(false);
        if (!mapResult.IsSuccess) return Result.Failure(mapResult.ErrorMessage!);
        var mindmap = mapResult.Value!;
        mindmap.Layout.Algorithm = algorithm;
        return await SaveMindmapAsync(mindmap).ConfigureAwait(false);
    }

    public bool WouldCreateCycle(Mindmap mindmap, string fromId, string toId)
    {
        // Simple BFS to see if toId can reach fromId via hierarchy edges
        var queue = new Queue<string>();
        queue.Enqueue(toId);
        var visited = new HashSet<string> { toId };

        while (queue.Count > 0)
        {
            var current = queue.Dequeue();
            if (current == fromId) return true;

            foreach (var edge in mindmap.Edges.Where(e => e.FromId == current && e.Kind == MindmapEdgeKind.Hierarchy))
            {
                if (!visited.Contains(edge.ToId))
                {
                    visited.Add(edge.ToId);
                    queue.Enqueue(edge.ToId);
                }
            }
        }

        return false;
    }
}
