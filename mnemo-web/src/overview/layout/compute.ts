/**
 * The board-level layout pass, ported from Mnemo.UI WidgetBoardPanel's MeasureOverride/ArrangeOverride
 * path (ComputeLayout and ComputePlacements). Turns widget coordinates into absolute pixel rects,
 * and decides which of the two placement algorithms the current width calls for.
 *
 * The desktop's third branch, stacking children full-width when no layout engine is bound, is
 * design-time-only and has no port equivalent.
 */

import { pack, resolve, resolveOrder, type WidgetPlacement, type WidgetSize } from "./engine"
import { cellWidthFor, columnCountForWidth, FALLBACK_WIDTH, GAP, MAX_COLUMNS, ROW_HEIGHT } from "./metrics"

/** A positioned box in board coordinates. */
export interface PlacedRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * The per-child layout input. Callers pass whole widget hosts, which carry an instance id and
 * settings too; only these three fields reach the engine.
 */
export interface ChildDesc {
  column: number
  row: number
  size: WidgetSize
}

export interface BoardLayout {
  /** One rect per child, in child order. */
  rects: PlacedRect[]
  /** The grid placements those rects came from, in child order. */
  placements: WidgetPlacement[]
  columnCount: number
  cellWidth: number
  /** Total board height, including the edit-mode growth row when it is shown. */
  extentHeight: number
  /** Rows the content actually occupies, excluding the growth row. Drives drop targeting. */
  usedRows: number
}

export function computeLayout(
  width: number,
  children: readonly ChildDesc[],
  anchorIndex: number,
  showEmptyCells: boolean,
): BoardLayout {
  // A ResizeObserver's first callback can report 0, so an unmeasured board lays out at the fallback
  // rather than collapsing to one column and re-flowing the whole grid a frame later.
  const boardWidth = Number.isFinite(width) && width > 0 ? width : FALLBACK_WIDTH

  const columnCount = columnCountForWidth(boardWidth)
  const cellWidth = cellWidthFor(boardWidth, columnCount)

  const placements =
    columnCount >= MAX_COLUMNS
      ? resolve(
          children.map((c) => ({ column: c.column, row: c.row, size: c.size })),
          columnCount,
          anchorIndex,
        )
      : packInFlowOrder(children, columnCount)

  const rects = placements.map((p) => ({
    x: p.column * (cellWidth + GAP),
    y: p.row * (ROW_HEIGHT + GAP),
    width: p.columnSpan * cellWidth + (p.columnSpan - 1) * GAP,
    height: p.rowSpan * ROW_HEIGHT + (p.rowSpan - 1) * GAP,
  }))

  // The 0 seed is what an empty board reports, so no length check is needed.
  let extentHeight = Math.max(0, ...rects.map((r) => r.y + r.height))
  const usedRows = Math.max(0, ...placements.map((p) => p.row + p.rowSpan))

  // Edit mode reserves one growth row so there is always a cell to drop onto below the content.
  if (showEmptyCells) extentHeight += (extentHeight > 0 ? GAP : 0) + ROW_HEIGHT

  return { rects, placements, columnCount, cellWidth, extentHeight, usedRows }
}

/**
 * Below the widest breakpoint the stored coordinates no longer fit the grid, so they become flow
 * order input only and dense packing recomputes every position. Canonical order is the same
 * (row, column, index) ordering `resolve` processes in, which is why it is borrowed rather than
 * rewritten; the desktop never forwards the drag anchor to Pack, so there is no anchor here either.
 */
function packInFlowOrder(children: readonly ChildDesc[], columnCount: number): WidgetPlacement[] {
  const order = resolveOrder(children, -1)
  const packed = pack(
    order.map((i) => children[i].size),
    columnCount,
  )

  const placements = new Array<WidgetPlacement>(children.length)
  order.forEach((childIndex, k) => {
    placements[childIndex] = packed[k]
  })
  return placements
}
