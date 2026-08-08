// Targeting at the widest breakpoint: 4 columns of 244px, so a column boundary falls every 260px
// and a row boundary every 136px.

import { describe, expect, it } from "vitest"
import { computeLayout } from "../layout/compute"
import { columnCountForWidth, FALLBACK_WIDTH } from "../layout/metrics"

import { getTargetCell, resolveCellWidth } from "./targeting"

const CELL_WIDTH = 244
const COLUMNS = 4

describe("getTargetCell", () => {
  it("maps a position to the cell that contains it", () => {
    expect(getTargetCell({ x: 0, y: 0 }, CELL_WIDTH, COLUMNS, 2)).toEqual({ column: 0, row: 0 })
    expect(getTargetCell({ x: 300, y: 200 }, CELL_WIDTH, COLUMNS, 2)).toEqual({ column: 1, row: 1 })
  })

  it("puts the boundary at the start of the gap, not the middle of it", () => {
    // 259 is still the first column's cell-plus-gap band; 260 begins the second.
    expect(getTargetCell({ x: 259, y: 135 }, CELL_WIDTH, COLUMNS, 3).column).toBe(0)
    expect(getTargetCell({ x: 260, y: 135 }, CELL_WIDTH, COLUMNS, 3).column).toBe(1)
    expect(getTargetCell({ x: 259, y: 135 }, CELL_WIDTH, COLUMNS, 3).row).toBe(0)
    expect(getTargetCell({ x: 259, y: 136 }, CELL_WIDTH, COLUMNS, 3).row).toBe(1)
  })

  it("clamps columns to the grid in both directions", () => {
    expect(getTargetCell({ x: 5000, y: 0 }, CELL_WIDTH, COLUMNS, 2).column).toBe(3)
    expect(getTargetCell({ x: -1, y: 0 }, CELL_WIDTH, COLUMNS, 2).column).toBe(0)
    expect(getTargetCell({ x: -900, y: 0 }, CELL_WIDTH, COLUMNS, 2).column).toBe(0)
  })

  it("allows exactly one row past the content and no further", () => {
    // rowExtent 2 means rows 0 and 1 hold tiles, so row 2 is the reachable growth row.
    expect(getTargetCell({ x: 0, y: 272 }, CELL_WIDTH, COLUMNS, 2).row).toBe(2)
    expect(getTargetCell({ x: 0, y: 408 }, CELL_WIDTH, COLUMNS, 2).row).toBe(2)
    expect(getTargetCell({ x: 0, y: 9000 }, CELL_WIDTH, COLUMNS, 2).row).toBe(2)
  })

  it("keeps an empty board droppable on row 0", () => {
    expect(getTargetCell({ x: 0, y: 500 }, CELL_WIDTH, COLUMNS, 0).row).toBe(0)
    expect(getTargetCell({ x: 0, y: -50 }, CELL_WIDTH, COLUMNS, 0).row).toBe(0)
  })

  it("tracks the narrow breakpoint's wider cells", () => {
    // 2 columns of 392px: the only boundary is at 408.
    expect(getTargetCell({ x: 407, y: 0 }, 392, 2, 1).column).toBe(0)
    expect(getTargetCell({ x: 408, y: 0 }, 392, 2, 1).column).toBe(1)
  })
})

describe("resolveCellWidth", () => {
  it("uses the measured width once there is one", () => {
    expect(resolveCellWidth(244, 4)).toBe(244)
  })

  it("falls back to the same cell width the layout pass would use", () => {
    // DELIBERATE DIVERGENCE from WidgetBoardPanel.GetTargetCell, which uses
    // `FallbackWidth / columnCount` and forgets the gaps its own layout pass subtracts. On four
    // columns that is 300 against the layout's 288, so a drag started before the first measure
    // aimed at a grid 12px per column wider than the one on screen and every column past the
    // first landed short. Reproducing that faithfully would mean shipping a known targeting bug.
    expect(resolveCellWidth(0, 4)).toBe(288)
    expect(resolveCellWidth(0, 2)).toBe(592)
    expect(resolveCellWidth(0, 1)).toBe(1200)
  })

  it("treats a negative measurement as no measurement", () => {
    expect(resolveCellWidth(-5, 4)).toBe(288)
  })

  it("agrees with the layout pass on an unmeasured board", () => {
    // The invariant the divergence above exists to establish, and the one worth guarding: the grid
    // a drag targets and the grid that gets drawn are the same grid. If these two ever disagree
    // again, a drag lands on the wrong column and nothing else in the suite would notice.
    for (const columnCount of [1, 2, 3, 4]) {
      const drawn = computeLayout(FALLBACK_WIDTH, [], -1, false)
      if (columnCountForWidth(FALLBACK_WIDTH) !== columnCount) continue
      expect(resolveCellWidth(0, columnCount)).toBe(drawn.cellWidth)
    }
  })

  it("targets sensibly against the fallback width", () => {
    const cellWidth = resolveCellWidth(0, COLUMNS)

    // 288 + 16 = 304 per column.
    expect(getTargetCell({ x: 303, y: 0 }, cellWidth, COLUMNS, 1).column).toBe(0)
    expect(getTargetCell({ x: 304, y: 0 }, cellWidth, COLUMNS, 1).column).toBe(1)
  })
})
