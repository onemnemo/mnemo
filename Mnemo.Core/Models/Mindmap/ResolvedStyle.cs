namespace Mnemo.Core.Models.Mindmap;

/// <summary>
/// An element's position in its cluster, needed to resolve depth-band rules and branch colors.
/// Free (non-hierarchy) elements use <see cref="Free"/>, whose negative <see cref="Depth"/> skips template
/// depth rules and branch coloring.
/// </summary>
public readonly record struct StyleContext
{
    public StyleContext(int depth, int branchIndex, bool isRoot)
    {
        Depth = depth;
        BranchIndex = branchIndex;
        IsRoot = isRoot;
    }

    /// <summary>Distance from the cluster root (root = 0); negative for free elements not in a tree.</summary>
    public int Depth { get; }

    /// <summary>Zero-based index of the depth-1 ancestor branch, for branch coloring; negative = none.</summary>
    public int BranchIndex { get; }

    public bool IsRoot { get; }

    /// <summary>A free element (shape/text/image/frame) with no hierarchy position.</summary>
    public static StyleContext Free => new(-1, -1, false);

    /// <summary>The cluster root (depth 0, no branch).</summary>
    public static StyleContext Root => new(0, -1, true);
}

/// <summary>
/// A fully-resolved element style: the cascade collapsed to concrete token references and enum values
///. Color members are theme token strings the UI maps to brushes — never null, never raw hex.
/// </summary>
public sealed record ResolvedStyle
{
    public required string Fill { get; init; }

    public required string Stroke { get; init; }

    public required string TextColor { get; init; }

    public required FontScale FontScale { get; init; }

    public required NodeShape NodeShape { get; init; }

    /// <summary>AppIcon name shown before the label, if any.</summary>
    public string? Icon { get; init; }

    /// <summary>The branch's palette token when branch coloring is active; null otherwise (edges reuse it).</summary>
    public string? BranchColor { get; init; }
}
