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
}
