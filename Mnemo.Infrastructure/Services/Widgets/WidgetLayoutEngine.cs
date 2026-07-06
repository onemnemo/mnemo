using System;
using System.Collections.Generic;
using System.Linq;
using Mnemo.Core.Models.Widgets;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Services.Widgets;

/// <summary>
/// Placement math for the overview board (pure — no UI types, no state). <see cref="Pack"/> is a
/// dense flow packer (CSS <c>grid-auto-flow: dense</c> semantics) used to seed coordinates and to
/// compact narrow breakpoints; <see cref="Resolve"/> honors each widget's stored coordinates,
/// pushing overlaps down only (free-grid placement).
/// </summary>
public sealed class WidgetLayoutEngine : IWidgetLayoutEngine
{
    public IReadOnlyList<WidgetPlacement> Pack(IReadOnlyList<WidgetSize> sizes, int columnCount)
    {
        ArgumentNullException.ThrowIfNull(sizes);
        if (columnCount < 1)
            throw new ArgumentOutOfRangeException(nameof(columnCount), columnCount, "Column count must be at least 1.");

        var placements = new WidgetPlacement[sizes.Count];
        var occupied = new List<bool[]>();

        for (var i = 0; i < sizes.Count; i++)
        {
            var columns = Math.Clamp(sizes[i].Columns, 1, columnCount);
            var rows = Math.Max(1, sizes[i].Rows);

            var (column, row) = FindFirstFit(occupied, columns, rows, columnCount);
            Occupy(occupied, column, row, columns, rows, columnCount);
            placements[i] = new WidgetPlacement(column, row, columns, rows);
        }

        return placements;
    }

    public IReadOnlyList<WidgetPlacement> Resolve(
        IReadOnlyList<WidgetDesiredPlacement> desired, int columnCount, int anchorIndex = -1)
    {
        ArgumentNullException.ThrowIfNull(desired);
        if (columnCount < 1)
            throw new ArgumentOutOfRangeException(nameof(columnCount), columnCount, "Column count must be at least 1.");

        var placements = new WidgetPlacement[desired.Count];
        var occupied = new List<bool[]>();

        foreach (var i in ResolveOrder(desired, anchorIndex))
        {
            var d = desired[i];
            var columns = Math.Clamp(d.Size.Columns, 1, columnCount);
            var rows = Math.Max(1, d.Size.Rows);

            int column, row;
            if (d.Column < 0 || d.Row < 0)
            {
                // Unassigned (freshly added / pre-coords): drop into the first free cell.
                (column, row) = FindFirstFit(occupied, columns, rows, columnCount);
            }
            else
            {
                column = Math.Clamp(d.Column, 0, columnCount - columns);
                // Push straight down until the desired column fits — never sideways, never up,
                // so an intentional gap above the widget survives.
                row = Math.Max(0, d.Row);
                while (!Fits(occupied, column, row, columns, rows))
                    row++;
            }

            Occupy(occupied, column, row, columns, rows, columnCount);
            placements[i] = new WidgetPlacement(column, row, columns, rows);
        }

        return placements;
    }

    /// <summary>
    /// Processing order for <see cref="Resolve"/>: the anchor (dragged tile) first so it keeps its
    /// dropped cell, then assigned widgets top-to-bottom / left-to-right, then any unassigned ones
    /// so they backfill the remaining holes. Original index breaks ties for determinism.
    /// </summary>
    private static IEnumerable<int> ResolveOrder(IReadOnlyList<WidgetDesiredPlacement> desired, int anchorIndex)
    {
        var indices = Enumerable.Range(0, desired.Count)
            .Where(i => i != anchorIndex)
            .OrderBy(i => desired[i].Row < 0 ? int.MaxValue : desired[i].Row)
            .ThenBy(i => desired[i].Column < 0 ? int.MaxValue : desired[i].Column)
            .ThenBy(i => i);

        if (anchorIndex >= 0 && anchorIndex < desired.Count)
            yield return anchorIndex;
        foreach (var i in indices)
            yield return i;
    }

    private static (int Column, int Row) FindFirstFit(List<bool[]> occupied, int columns, int rows, int columnCount)
    {
        // Scanning one row past the current extent guarantees a fit is always found.
        for (var row = 0; row <= occupied.Count; row++)
        {
            for (var column = 0; column <= columnCount - columns; column++)
            {
                if (Fits(occupied, column, row, columns, rows))
                    return (column, row);
            }
        }

        return (0, occupied.Count);
    }

    private static bool Fits(List<bool[]> occupied, int column, int row, int columns, int rows)
    {
        for (var r = row; r < row + rows; r++)
        {
            if (r >= occupied.Count)
                return true; // Rows below the current extent are empty by definition.

            for (var c = column; c < column + columns; c++)
            {
                if (occupied[r][c])
                    return false;
            }
        }

        return true;
    }

    private static void Occupy(List<bool[]> occupied, int column, int row, int columns, int rows, int columnCount)
    {
        while (occupied.Count < row + rows)
            occupied.Add(new bool[columnCount]);

        for (var r = row; r < row + rows; r++)
        {
            for (var c = column; c < column + columns; c++)
                occupied[r][c] = true;
        }
    }
}
