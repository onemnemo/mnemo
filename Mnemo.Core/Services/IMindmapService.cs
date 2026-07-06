using System.Collections.Generic;
using System.Threading.Tasks;
using Mnemo.Core.Models;
using Mnemo.Core.Models.Mindmap;

namespace Mnemo.Core.Services;

public interface IMindmapService
{
    Task<Result<IEnumerable<Mindmap>>> GetAllMindmapsAsync();
    Task<Result<Mindmap>> GetMindmapAsync(string id);
    Task<Result<Mindmap>> CreateMindmapAsync(string title);
    Task<Result<Mindmap>> CreateMindmapAsync(string title, string? folderId);
    Task<Result> SaveMindmapAsync(Mindmap mindmap);
    Task<Result> DeleteMindmapAsync(string id);

    // Folders
    Task<Result<IReadOnlyList<MindmapFolder>>> GetFoldersAsync();
    Task<Result> SaveFolderAsync(MindmapFolder folder);
    Task<Result> DeleteFolderAsync(string folderId);

    // Graph operations
    Task<Result<MindmapNode>> AddNodeAsync(string mindmapId, string nodeType, IMindmapNodeContent content, double x, double y);
    Task<Result> RemoveNodeAsync(string mindmapId, string nodeId);
    Task<Result<MindmapEdge>> AddEdgeAsync(string mindmapId, string fromId, string toId, MindmapEdgeKind kind, string? label = null, string? type = null);
    Task<Result> RemoveEdgeAsync(string mindmapId, string edgeId);
    Task<Result> UpdateEdgeLabelAsync(string mindmapId, string edgeId, string? label);
    Task<Result> UpdateEdgeKindAsync(string mindmapId, string edgeId, MindmapEdgeKind kind);
    Task<Result> UpdateEdgeTypeAsync(string mindmapId, string edgeId, string type);
    Task<Result> UpdateNodeContentAsync(string mindmapId, string nodeId, IMindmapNodeContent content);
    Task<Result> UpdateNodeLayoutAsync(string mindmapId, string nodeId, double x, double y, double? width = null, double? height = null);
    Task<Result> UpdateNodeStyleAsync(string mindmapId, string nodeId, IReadOnlyDictionary<string, string?> styleUpdates);
    Task<Result> UpdateLayoutAlgorithmAsync(string mindmapId, string algorithm);

    // Integrity
    bool WouldCreateCycle(Mindmap mindmap, string fromId, string toId);
}
