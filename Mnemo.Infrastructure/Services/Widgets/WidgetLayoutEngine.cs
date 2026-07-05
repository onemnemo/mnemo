using System;
using System.Collections.Generic;
using Mnemo.Core.Models.Widgets;
using Mnemo.Core.Services;

namespace Mnemo.Infrastructure.Services.Widgets;

/// <summary>
/// Dense flow packer (CSS <c>grid-auto-flow: dense</c> semantics). Each widget scans the
/// occupancy grid row-major from the top-left and takes the first rectangle it fits into,
/// so earlier holes are filled by later widgets that fit. Pure math — no UI types, no state.
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
