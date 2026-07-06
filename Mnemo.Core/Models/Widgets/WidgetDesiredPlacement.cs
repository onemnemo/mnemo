namespace Mnemo.Core.Models.Widgets;

/// <summary>
/// A widget's requested board position and span, fed to <c>IWidgetLayoutEngine.Resolve</c>.
/// <see cref="Column"/>/<see cref="Row"/> are the canonical (4-column) grid coordinates the
/// user placed it at; <c>-1</c> means unassigned (place at the first free cell). The engine
/// clamps spans/coordinates to the active grid and pushes overlaps down.
/// </summary>
public readonly record struct WidgetDesiredPlacement(int Column, int Row, WidgetSize Size);
