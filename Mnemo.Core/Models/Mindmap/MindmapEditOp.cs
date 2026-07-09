using System;
using System.Collections.Generic;

namespace Mnemo.Core.Models.Mindmap;

/// <summary>
/// One operation in an edit batch. The editor and the AI agent drive this same command vocabulary.
/// Every UI gesture and every tool op is one of these, so agent edits are undoable and the
/// tool surface never lags behind features. The compact AI wire projection is a separate concern;
/// these are the strongly-typed commands the service applies.
/// </summary>
public abstract record MindmapEditOp;

/// <summary>Specification for a node to create, possibly with nested children (a subtree insert).</summary>
public sealed record MindmapNodeSpec
{
    /// <summary>Caller-local reference key; if set, the created id is returned under it in the id map.</summary>
    public string? Ref { get; init; }

    /// <summary>Shorthand for a <see cref="TextContent"/> body. Ignored when <see cref="Content"/> is set.</summary>
    public string? Text { get; init; }

    /// <summary>Explicit content; overrides <see cref="Text"/> when both are present.</summary>
    public IElementContent? Content { get; init; }

    public IReadOnlyList<MindmapNodeSpec> Children { get; init; } = Array.Empty<MindmapNodeSpec>();

    /// <summary>Optional explicit X; when both X and Y are set the node is placed there and pinned.</summary>
    public double? X { get; init; }

    /// <summary>Optional explicit Y; see <see cref="X"/>.</summary>
    public double? Y { get; init; }
}

/// <summary>Insert a nested subtree. No <see cref="Under"/> = a new floating cluster. Returns an id map.</summary>
public sealed record AddNodesOp : MindmapEditOp
{
    /// <summary>Parent node id, or null for a new root cluster.</summary>
    public string? Under { get; init; }

    /// <summary>Insert the new top-level nodes after this sibling id (ordering among siblings).</summary>
    public string? After { get; init; }

    public required IReadOnlyList<MindmapNodeSpec> Nodes { get; init; }
}

/// <summary>Partial update of a single element. Null members are left unchanged.</summary>
public sealed record SetOp : MindmapEditOp
{
    public required string Id { get; init; }

    /// <summary>Text shorthand: sets the element's primary text slot for its kind.</summary>
    public string? Text { get; init; }

    /// <summary>Replace the element's content wholesale (must match the element's kind).</summary>
    public IElementContent? Content { get; init; }

    /// <summary>Merge these style overrides onto the element's existing style (non-null members win).</summary>
    public ElementStyle? Style { get; init; }

    /// <summary>Drop the element's existing style override before applying <see cref="Style"/>, resetting it to the template default.</summary>
    public bool ClearStyle { get; init; }

    public bool? Collapsed { get; init; }

    public bool? Pinned { get; init; }

    /// <summary>New explicit width (e.g. from a resize handle). Null leaves it unchanged.</summary>
    public double? Width { get; init; }

    /// <summary>New explicit height. Null leaves it unchanged.</summary>
    public double? Height { get; init; }
}

/// <summary>Reparent a node (cycle-checked) or reposition an element. Repositioning implies pinning.</summary>
public sealed record MoveOp : MindmapEditOp
{
    public required string Id { get; init; }

    /// <summary>New parent node id (reparent). Mutually exclusive with an X/Y reposition.</summary>
    public string? Under { get; init; }

    /// <summary>When reparenting, insert after this sibling id.</summary>
    public string? After { get; init; }

    /// <summary>New X (set together with <see cref="Y"/> to reposition).</summary>
    public double? X { get; init; }

    /// <summary>New Y (set together with <see cref="X"/> to reposition).</summary>
    public double? Y { get; init; }
}

/// <summary>Delete elements, cascading through hierarchy subtrees. Deleting a frame orphans its members.</summary>
public sealed record DeleteOp : MindmapEditOp
{
    public required IReadOnlyList<string> Ids { get; init; }
}

/// <summary>Create a link edge between any two elements (whiteboard connectors included).</summary>
public sealed record LinkOp : MindmapEditOp
{
    /// <summary>Caller-local reference key for the created edge id in the id map.</summary>
    public string? Ref { get; init; }

    public required string A { get; init; }

    public required string B { get; init; }

    public string? Label { get; init; }

    public EdgeStyle? Style { get; init; }
}

/// <summary>Remove an edge by id, or by its (from, to) endpoints. Removing a hierarchy edge detaches the child.</summary>
public sealed record UnlinkOp : MindmapEditOp
{
    public string? EdgeId { get; init; }

    public string? A { get; init; }

    public string? B { get; init; }
}

/// <summary>Update an existing edge's label and/or style overrides (by edge id).</summary>
public sealed record SetEdgeOp : MindmapEditOp
{
    public required string EdgeId { get; init; }

    /// <summary>New label; an empty string clears it. Null leaves the label unchanged.</summary>
    public string? Label { get; init; }

    /// <summary>Merge these style overrides onto the edge's existing style (non-null members win).</summary>
    public EdgeStyle? Style { get; init; }

    /// <summary>Drop the edge's existing style override before applying <see cref="Style"/>.</summary>
    public bool ClearStyle { get; init; }
}

/// <summary>Bulk style application to a subtree root (and descendants) or an explicit id list.</summary>
public sealed record StyleSubtreeOp : MindmapEditOp
{
    public string? Root { get; init; }

    public IReadOnlyList<string>? Ids { get; init; }

    public required ElementStyle Style { get; init; }
}

/// <summary>Set per-cluster layout preferences, or the document default template when <see cref="Root"/> is null.</summary>
public sealed record LayoutOp : MindmapEditOp
{
    public string? Root { get; init; }

    public string? Algorithm { get; init; }

    public string? TemplateId { get; init; }

    public LayoutOptions? Options { get; init; }
}

/// <summary>Create a free (non-node) element: shape, free text, canvas image or frame.</summary>
public sealed record AddElementOp : MindmapEditOp
{
    /// <summary>Caller-local reference key for the created id in the id map.</summary>
    public string? Ref { get; init; }

    public ElementKind Kind { get; init; }

    public double X { get; init; }

    public double Y { get; init; }

    public required IElementContent Content { get; init; }

    public double? Width { get; init; }

    public double? Height { get; init; }
}

/// <summary>Add or remove frame members.</summary>
public sealed record FrameOp : MindmapEditOp
{
    public required string Id { get; init; }

    public IReadOnlyList<string>? Add { get; init; }

    public IReadOnlyList<string>? Remove { get; init; }
}
