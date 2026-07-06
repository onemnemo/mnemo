namespace Mnemo.UI.Modules.Mindmap.ViewModels;

/// <summary>One clickable crumb in the folder path. A null <see cref="Id"/> targets the library root.</summary>
public sealed record MindmapBreadcrumbSegment(string? Id, string Name);

/// <summary>Sentinel placed at the end of a folder's grid to render the dashed "new map" tile.</summary>
public sealed class MindmapNewTilePlaceholder
{
    public static readonly MindmapNewTilePlaceholder Instance = new();
    private MindmapNewTilePlaceholder() { }
}
