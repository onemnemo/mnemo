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
 * The cell under `point`. Columns clamp to the active grid; rows clamp to one past the current
 * extent, which is what keeps a new bottom row reachable by dropping just below the content.
 *
 * `rowExtent` is the packed row count (computeLayout's `usedRows`), not that plus one: the
 * allowance is in the clamp, not in the caller's number.
 */
export function getTargetCell(
  point: Point,
  cellWidth: number,
  columnCount: number,
  rowExtent: number,
): TargetCell {
  return {
    column: clamp(Math.floor(point.x / (cellWidth + GAP)), 0, columnCount - 1),
    row: clamp(Math.floor(point.y / (ROW_HEIGHT + GAP)), 0, rowExtent),
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
