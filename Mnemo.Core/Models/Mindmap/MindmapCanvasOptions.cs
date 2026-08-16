namespace Mnemo.Core.Models.Mindmap;

/// <summary>Canvas background rendering style.</summary>
public enum CanvasBackground
{
    Dots,
    Grid,
    Plain,
}

/// <summary>Document-level canvas options.</summary>
public sealed record MindmapCanvasOptions
{
    public CanvasBackground Background { get; init; } = CanvasBackground.Dots;

    /// <summary>Default style template id for the document; null = module built-in default.</summary>
    public string? DefaultTemplateId { get; init; }

    /// <summary>
    /// How this map's edges are drawn when neither the edge itself nor its template says otherwise.
    /// </summary>
    /// <remarks>
    /// It belongs on the document because it is a property of the map, not of the session looking at
    /// it. Held in the editor instead it would revert on every navigation away, would never reach a
    /// thumbnail, and would be invisible to undo, leaving the branch style as the one thing on the
    /// canvas that cannot be taken back.
    /// </remarks>
    public EdgeStyle? EdgeDefaults { get; init; }
}
