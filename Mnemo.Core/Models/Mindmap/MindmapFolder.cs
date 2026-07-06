namespace Mnemo.Core.Models.Mindmap;

/// <summary>
/// A folder used to group mindmaps in the library. Folders may nest via <see cref="ParentId"/>.
/// </summary>
public sealed record MindmapFolder(
    string Id,
    string Name,
    string? ParentId,
    int Order);
