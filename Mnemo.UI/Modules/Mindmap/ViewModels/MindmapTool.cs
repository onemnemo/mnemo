namespace Mnemo.UI.Modules.Mindmap.ViewModels;

/// <summary>
/// The sticky canvas tool selected in the bottom toolbar (or via its shortcut). Create actions
/// (node/text/frame/shape/image) are one-shot and don't change the active tool.
/// </summary>
public enum MindmapTool
{
    /// <summary>Click selects, drag on an element moves it, drag on empty canvas draws a marquee. (V)</summary>
    Select,

    /// <summary>Drag anywhere pans the camera; selection is untouched. (H)</summary>
    Pan,

    /// <summary>Press-drag from one element to another creates (or removes) a link edge. (C)</summary>
    Connect,
}
