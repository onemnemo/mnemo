namespace Mnemo.Core.Models.Mindmap;

/// <summary>
/// A map's two addresses: the internal document id (<see cref="MindmapDocument.Id"/>) and the
/// corpus-unique short id external callers, such as the AI tools, address it by instead.
/// </summary>
public sealed record MindmapIdentity(string Id, string Sid);
