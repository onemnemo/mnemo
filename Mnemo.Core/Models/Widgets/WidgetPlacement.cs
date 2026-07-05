namespace Mnemo.Core.Models.Widgets;

/// <summary>
/// Computed board position of one widget instance: the cell the packer assigned plus the
/// (possibly clamped) span it occupies. Transient output of the layout engine — never persisted.
/// </summary>
public readonly record struct WidgetPlacement(int Column, int Row, int ColumnSpan, int RowSpan);
