using System.Collections.Generic;
using Mnemo.Core.Models.Widgets;

namespace Mnemo.Core.Services;

/// <summary>
/// Pure flow-packing logic for the overview board. Widgets are an ordered list of spans;
/// positions are computed by packing left-to-right, top-to-bottom, filling holes densely
/// (CSS <c>grid-auto-flow: dense</c> semantics). All placement decisions go through this
/// engine — never through panels or code-behind.
/// </summary>
public interface IWidgetLayoutEngine
{
    /// <summary>
    /// Packs <paramref name="sizes"/> (in board order) into a grid of
    /// <paramref name="columnCount"/> columns. Spans wider than the active column count are
    /// clamped; rows are unbounded. Returns one placement per input, same order.
    /// </summary>
    IReadOnlyList<WidgetPlacement> Pack(IReadOnlyList<WidgetSize> sizes, int columnCount);
}
