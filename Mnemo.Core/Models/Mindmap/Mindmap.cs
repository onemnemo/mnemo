using System;
using System.Collections.Generic;

namespace Mnemo.Core.Models.Mindmap;

public class Mindmap
{
    public int Version { get; set; } = 1;
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string Title { get; set; } = "New Mindmap";
    public string? RootNodeId { get; set; }
    public List<MindmapNode> Nodes { get; set; } = new();
    public List<MindmapEdge> Edges { get; set; } = new();
    public MindmapLayout Layout { get; set; } = new();
    public DateTime? ModifiedAt { get; set; }

    /// <summary>Owning folder in the library, or <c>null</c> when the map lives at the root.</summary>
    public string? FolderId { get; set; }

    /// <summary>Flashcard deck ids linked to this map; their due counts surface as a library badge.</summary>
    public List<string> LinkedDeckIds { get; set; } = new();
}
