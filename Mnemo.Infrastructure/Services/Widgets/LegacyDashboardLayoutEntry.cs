namespace Mnemo.Infrastructure.Services.Widgets;

/// <summary>
/// Shape of one entry in the v1 overview layout (absolute 12-column grid, one instance per
/// widget type). Kept only so <see cref="OverviewLayoutStore"/> can migrate old installs;
/// property names must match the historical JSON exactly.
/// </summary>
public sealed record LegacyDashboardLayoutEntry(
    string WidgetId,
    int Column,
    int Row,
    int ColSpan,
    int RowSpan);
