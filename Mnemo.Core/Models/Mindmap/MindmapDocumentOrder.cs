using System;
using System.Collections.Generic;
using System.Linq;

namespace Mnemo.Core.Models.Mindmap;

/// <summary>
/// Element and edge ids in document order, the companion a <see cref="MindmapRestoreDelta"/> cannot do
/// without.
/// <para>
/// Sibling order is not a field on anything: it is the order of the hierarchy edges in the document's
/// edge array, which a set-shaped delta has no way to express. A caller that applies a delta and then
/// sorts both arrays to these id lists reproduces the committed document exactly; one that does not
/// sends every inserted sibling to the end.
/// </para>
/// </summary>
public sealed record MindmapDocumentOrder
{
    public IReadOnlyList<string> Elements { get; init; } = Array.Empty<string>();

    public IReadOnlyList<string> Edges { get; init; } = Array.Empty<string>();

    /// <summary>Reads the order off a document.</summary>
    public static MindmapDocumentOrder Of(MindmapDocument document)
    {
        ArgumentNullException.ThrowIfNull(document);

        return new MindmapDocumentOrder
        {
            Elements = document.Elements.Select(e => e.Id).ToList(),
            Edges = document.Edges.Select(e => e.Id).ToList(),
        };
    }
}
