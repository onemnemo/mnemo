/**
 * Free-cell derivation for the edit-mode hint layer, ported from WidgetBoardPanel.RebuildHintCells.
 */

import type { WidgetPlacement } from "./engine"
import type { PlacedRect } from "./compute"
import { GAP, ROW_HEIGHT } from "./metrics"

/**
 * One 1x1 rect per free cell across the packed rows plus one growth row below them.
 *
 * Adjacent free cells are never merged into a wider rectangle: the hint layer draws a dashed "1x1"
 * square per cell, so a two-wide gap is two squares. Whether hints are shown at all is the caller's
 * decision, this only derives them.
 */
export function computeHintCells(
  placements: readonly WidgetPlacement[],
  columnCount: number,
  cellWidth: number,
): PlacedRect[] {
  const usedRows = Math.max(0, ...placements.map((p) => p.row + p.rowSpan))
  // The growth row is why an empty board still shows a full row of hints.
  const hintRows = usedRows + 1

  const occupied = Array.from({ length: hintRows }, () => new Array<boolean>(columnCount).fill(false))
  for (const p of placements) {
    // Clipped on both axes, as the C# does: a placement is never expected to overhang the grid, and
    // the hint layer is not the place to find out that one did.
    for (let r = p.row; r < Math.min(p.row + p.rowSpan, hintRows); r++) {
      for (let c = p.column; c < Math.min(p.column + p.columnSpan, columnCount); c++) occupied[r][c] = true
    }
  }

  const cells: PlacedRect[] = []
  for (let r = 0; r < hintRows; r++) {
    for (let c = 0; c < columnCount; c++) {
      if (occupied[r][c]) continue

      cells.push({
        x: c * (cellWidth + GAP),
        y: r * (ROW_HEIGHT + GAP),
        width: cellWidth,
        height: ROW_HEIGHT,
      })
    }
  }

  return cells
}
