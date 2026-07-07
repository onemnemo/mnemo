namespace Mnemo.Core.Models.MindmapV2;

/// <summary>
/// Built-in layout algorithm ids. <see cref="ClusterSettings.LayoutAlgorithm"/> is a string rather than
/// an enum because layouts are an open registry. Plugins register their own providers. These six
/// ship built-in; unknown ids fall back to <see cref="Balanced"/> at layout time.
/// </summary>
public static class MindmapLayoutAlgorithms
{
    /// <summary>Root centered, branches split left/right. Default.</summary>
    public const string Balanced = "balanced";

    /// <summary>Root left, children flow right.</summary>
    public const string TreeRight = "treeRight";

    /// <summary>Root top, children flow down.</summary>
    public const string TreeDown = "treeDown";

    /// <summary>Concentric rings around the root.</summary>
    public const string Radial = "radial";

    /// <summary>Root left, depth-1 children as a horizontal sequence, subtrees hanging below.</summary>
    public const string Timeline = "timeline";

    /// <summary>No auto-layout; every node behaves as pinned.</summary>
    public const string Free = "free";

    /// <summary>The ids shipped built-in, in switcher order.</summary>
    public static readonly string[] BuiltIn = { Balanced, TreeRight, TreeDown, Radial, Timeline, Free };
}
