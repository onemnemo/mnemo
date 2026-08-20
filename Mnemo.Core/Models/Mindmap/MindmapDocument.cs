using System;
using System.Collections.Generic;

namespace Mnemo.Core.Models.Mindmap;

/// <summary>
/// A schema v2 mindmap document: an infinite freeform canvas holding tree nodes, shapes, free text,
/// images and frames as a single element model. Instances are immutable;
/// every committed edit produces a new document with an incremented <see cref="Revision"/>. Only the
/// command layer (the service graph mutator) assembles new document states. Nothing else may.
/// </summary>
public sealed record MindmapDocument
{
    /// <summary>Storage schema version. v2 readers reject other versions on load.</summary>
    public int SchemaVersion { get; init; } = 2;

    /// <summary>Stable external identity (GUID) used for search, navigation and <c>.mnemo</c> packages.</summary>
    public required string Id { get; init; }

    public string Title { get; init; } = "Untitled";

    /// <summary>Monotonic revision, bumped once per committed edit batch (optimistic concurrency).</summary>
    public long Revision { get; init; }

    public IReadOnlyList<MindmapElement> Elements { get; init; } = Array.Empty<MindmapElement>();

    public IReadOnlyList<MindmapEdge> Edges { get; init; } = Array.Empty<MindmapEdge>();

    /// <summary>Per-tree layout and template preferences, keyed by cluster root id.</summary>
    public IReadOnlyList<ClusterSettings> Clusters { get; init; } = Array.Empty<ClusterSettings>();

    public MindmapCanvasOptions Canvas { get; init; } = new();

    public DateTime CreatedAt { get; init; }

    public DateTime ModifiedAt { get; init; }
}
