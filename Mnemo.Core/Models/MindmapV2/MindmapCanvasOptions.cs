namespace Mnemo.Core.Models.MindmapV2;

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
}
