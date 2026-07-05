namespace Mnemo.UI.Modules.Overview;

/// <summary>
/// Presentation metrics for the overview widget board. The board is a responsive auto-flow
/// grid: the column count derives from the available width, cells stretch horizontally, and
/// rows have a fixed height. Packing math lives in <c>IWidgetLayoutEngine</c> — these are
/// only the pixel constants the panel feeds it.
/// </summary>
public static class OverviewBoardMetrics
{
    /// <summary>Maximum number of columns (wide layout).</summary>
    public const int MaxColumns = 4;

    /// <summary>Height of one grid row in pixels.</summary>
    public const double RowHeight = 112;

    /// <summary>Gap between cells in pixels.</summary>
    public const double Gap = 12;

    /// <summary>Responsive column count: 4 (wide) → 2 (medium) → 1 (narrow).</summary>
    public static int ColumnCountForWidth(double width) => width switch
    {
        >= 1024 => MaxColumns,
        >= 560 => 2,
        _ => 1
    };
}
