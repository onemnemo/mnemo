using System;

namespace Mnemo.Core.Models.Mindmap;

/// <summary>
/// Lightweight document header for listing maps without deserializing the full document JSON. Sourced
/// from the indexed storage columns.
/// </summary>
public sealed record MindmapDocumentSummary
{
    public required string Id { get; init; }

    public required string Title { get; init; }

    public long Revision { get; init; }

    public DateTime ModifiedAt { get; init; }
}
