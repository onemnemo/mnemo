using System.Collections.Generic;
using Mnemo.Core.Models.Widgets;

namespace Mnemo.Core.Services;

/// <summary>
/// Pure placement logic for the overview board. Two modes, both UI-free:
/// <see cref="Resolve"/> honors each widget's stored coordinates (free-grid placement),
/// and <see cref="Pack"/> flows an ordered list densely (used to seed coordinates on
/// migration and to compact narrow breakpoints). All placement decisions go through this
/// engine — never through panels or code-behind.
/// </summary>
public interface IWidgetLayoutEngine
{
    /// <summary>
    /// Packs <paramref name="sizes"/> (in board order) into a grid of
    /// <paramref name="columnCount"/> columns. Spans wider than the active column count are
    /// clamped; rows are unbounded. Returns one placement per input, same order.
    /// Fills holes densely (CSS <c>grid-auto-flow: dense</c> semantics).
    /// </summary>
    IReadOnlyList<WidgetPlacement> Pack(IReadOnlyList<WidgetSize> sizes, int columnCount);

    /// <summary>
    /// Resolves <paramref name="desired"/> free-grid placements into non-overlapping cells on a
    /// grid of <paramref name="columnCount"/> columns. Spans and coordinates are clamped to the
    /// grid; a widget with unassigned coordinates (<c>-1</c>) drops into the first free cell.
    /// Overlaps are resolved by pushing the later widget <em>down</em> only — there is no upward
    /// compaction, so an intentional gap above a widget is preserved. When
    /// <paramref name="anchorIndex"/> is a valid index, that widget is placed first so it keeps
    /// the cell it was dropped on and everything else yields around it. Returns one placement per
    /// input, same order.
    /// </summary>
    IReadOnlyList<WidgetPlacement> Resolve(
        IReadOnlyList<WidgetDesiredPlacement> desired, int columnCount, int anchorIndex = -1);
}
