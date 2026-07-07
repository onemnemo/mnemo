namespace Mnemo.Core.Models.MindmapV2;

/// <summary>
/// A library folder for organizing mindmaps. Folders nest via <see cref="ParentId"/> (parent-pointer
/// only). This is library organization metadata, not part of the <see cref="MindmapDocument"/>
/// structure, which stays a pure canvas model. A map's folder membership lives on its storage row.
/// </summary>
public sealed record MindmapFolder(string Id, string Name, string? ParentId, int Order);
