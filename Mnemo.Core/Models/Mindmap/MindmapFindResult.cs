using System;
using System.Collections.Generic;

namespace Mnemo.Core.Models.Mindmap;

/// <summary>
/// Result of an in-map full-text search (<c>find_in_map</c>): the matching elements plus the document
/// revision they were read at, so a follow-up edit can carry that <see cref="Revision"/>.
/// </summary>
public sealed record MindmapFindResult
{
    /// <summary>The document revision the hits were read at.</summary>
    public long Revision { get; init; }

    public IReadOnlyList<MindmapFindHit> Hits { get; init; } = Array.Empty<MindmapFindHit>();
}

/// <summary>A single in-map search match: the element, its indexed text, and its hierarchy breadcrumb.</summary>
public sealed record MindmapFindHit
{
    public required string ElementId { get; init; }

    /// <summary>The element's indexed text (the label/task/code/caption that matched).</summary>
    public required string Text { get; init; }

    /// <summary>
    /// Ancestor node texts from root to the hit's parent, joined with " &gt; ". Empty for root nodes and
    /// free (non-tree) elements. Lets the agent jump to the right branch of a large map without a full read.
    /// </summary>
    public string Path { get; init; } = string.Empty;
}
