namespace Mnemo.Core.Models.Widgets;

/// <summary>
/// Size of a widget on the overview board as a column × row span.
/// Spans are grid units, not pixels; the active column count clamps <see cref="Columns"/> at layout time.
/// </summary>
public readonly record struct WidgetSize(int Columns, int Rows)
{
    public override string ToString() => $"{Columns}x{Rows}";
}
