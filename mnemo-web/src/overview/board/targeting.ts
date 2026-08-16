/**
 * Pointer position to grid cell, ported from WidgetBoardPanel.GetTargetCell. Pure so the drag layer
 * has nothing to reason about beyond which board metrics it last saw.
 */

import { clamp } from "../layout/clamp"
import { fallbackCellWidth, GAP, ROW_HEIGHT } from "../layout/metrics"

/** A pointer position in board coordinates. */
export interface Point {
  x: number
  y: number
}

export interface TargetCell {
  column: number
  row: number
}

/**
 * The cell a tile whose top-left corner sits at `point` would land in.
 *
 * Rounded, not floored, and measured from the tile's own corner rather than from the pointer: the
 * tile is drawn free of the grid during a drag, so the cell it snaps to should be the one it is
 * nearest to. Flooring the pointer instead means a tile visibly covering a cell can be about to
 * land in its neighbour, which is the single thing that makes a board drag feel unpredictable.
 *
 * Columns clamp so a wide tile cannot hang off the right edge; rows clamp to one past the current
 * extent, which is what keeps a new bottom row reachable by dropping just below the content.
 * `rowExtent` is the packed row count (computeLayout's `usedRows`), not that plus one: the
 * allowance is in the clamp, not in the caller's number.
 */
export function getTargetCell(
  point: Point,
  cellWidth: number,
  columnCount: number,
  rowExtent: number,
  columnSpan = 1,
): TargetCell {
  const widest = Math.max(0, columnCount - Math.min(columnSpan, columnCount))
  return {
    column: clamp(Math.round(point.x / (cellWidth + GAP)), 0, widest),
    row: clamp(Math.round(point.y / (ROW_HEIGHT + GAP)), 0, rowExtent),
  }
}

/**
 * Cell width to target against, given the last width the board measured. A drag can begin before
 * the first layout pass has recorded one, and the fallback substitutes for it rather than dividing
 * by zero and sending every pointer position to column 0. It has to be the SAME fallback the
 * layout pass uses, or the drag aims at a grid that is not the one on screen.
 *
 * Split out of `getTargetCell`, which the C# folds it into, so the fallback is testable on its own
 * and the targeting math stays a pure function of already-resolved metrics.
 */
export function resolveCellWidth(lastCellWidth: number, columnCount: number): number {
  if (lastCellWidth > 0) return lastCellWidth
  return fallbackCellWidth(columnCount)
}
