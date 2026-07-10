using System;
using System.Collections.Generic;

namespace Mnemo.Core.Models.Mindmap;

/// <summary>The kind of dangling reference an integrity sweep found on an element.</summary>
public enum MindmapIntegrityIssueKind
{
    /// <summary>A note reference points at a note that no longer exists.</summary>
    MissingNote,

    /// <summary>A flashcard reference points at a deck that no longer exists.</summary>
    MissingDeck,

    /// <summary>An image element or node references an asset file that is not on disk.</summary>
    MissingImageAsset,
}

/// <summary>
/// One dangling reference: which element carries it, what broke, and the unresolved target id (note id,
/// deck id, or image asset id). Reference resolution is lazy at render time, so a dangling ref never breaks
/// a document. It is surfaced here instead.
/// </summary>
public sealed record MindmapIntegrityIssue
{
    /// <summary>Short id of the element holding the broken reference.</summary>
    public required string ElementId { get; init; }

    public required MindmapIntegrityIssueKind Kind { get; init; }

    /// <summary>The referenced target that could not be resolved.</summary>
    public required string TargetId { get; init; }

    /// <summary>The element's own searchable text, for context; empty for pure reference nodes.</summary>
    public string ElementText { get; init; } = string.Empty;
}

/// <summary>
/// The result of an integrity sweep over one map: every dangling note/deck/image reference, tagged with the
/// revision the sweep ran against. Surfaced in the UI and as an AI tool warning.
/// </summary>
public sealed record MindmapIntegrityReport
{
    public required string MapId { get; init; }

    /// <summary>The document revision the sweep observed.</summary>
    public long Revision { get; init; }

    public IReadOnlyList<MindmapIntegrityIssue> Issues { get; init; } = Array.Empty<MindmapIntegrityIssue>();
}
