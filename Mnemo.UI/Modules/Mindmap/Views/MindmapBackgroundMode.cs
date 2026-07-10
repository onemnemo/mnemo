namespace Mnemo.UI.Modules.Mindmap.Views;

/// <summary>How the canvas backdrop is drawn behind the mindmap, from the "Mindmap.GridType" setting.</summary>
public enum MindmapBackgroundMode
{
    /// <summary>Plain background, no grid.</summary>
    None,

    /// <summary>Camera-aligned dot field.</summary>
    Dots,

    /// <summary>Camera-aligned line grid.</summary>
    Lines,
}
