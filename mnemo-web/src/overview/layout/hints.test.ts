// Hint cells at the widest breakpoint: 4 columns of 244px, so the cell pitch is 260 across and 136
// down, and every hint is exactly one cell (244 x 120).

import { describe, expect, it } from "vitest"

import { computeHintCells, freeCells } from "./hints"
import type { WidgetPlacement } from "./engine"

const CELL_WIDTH = 244

function p(column: number, row: number, columnSpan: number, rowSpan: number): WidgetPlacement {
  return { column, row, columnSpan, rowSpan }
}

describe("computeHintCells", () => {
  it("emits one 1x1 rect per free cell, never merging neighbours", () => {
    // Columns 2 and 3 of row 0 are both free and adjacent. Merging them would be the natural thing
    // to write and would draw one wide box where the board draws two squares.
    const cells = computeHintCells([p(1, 0, 1, 1)], 4, CELL_WIDTH)

    const rowZero = cells.filter((c) => c.y === 0)
    expect(rowZero).toEqual([
      { x: 0, y: 0, width: 244, height: 120 },
      { x: 520, y: 0, width: 244, height: 120 },
      { x: 780, y: 0, width: 244, height: 120 },
    ])
  })

  it("includes one growth row below the packed extent", () => {
    const cells = computeHintCells([p(0, 0, 4, 1)], 4, CELL_WIDTH)

    // Row 0 is full, so every hint belongs to the growth row.
    expect(cells).toEqual([
      { x: 0, y: 136, width: 244, height: 120 },
      { x: 260, y: 136, width: 244, height: 120 },
      { x: 520, y: 136, width: 244, height: 120 },
      { x: 780, y: 136, width: 244, height: 120 },
    ])
  })

  it("covers a multi-row placement's whole footprint", () => {
    const cells = computeHintCells([p(0, 0, 1, 2)], 4, CELL_WIDTH)

    // Rows 0 and 1 lose column 0; row 2 is the growth row and is entirely free.
    expect(cells.map((c) => `${String(c.x)},${String(c.y)}`)).toEqual([
      "260,0",
      "520,0",
      "780,0",
      "260,136",
      "520,136",
      "780,136",
      "0,272",
      "260,272",
      "520,272",
      "780,272",
    ])
  })

  it("gives an empty board a single row of hints", () => {
    const cells = computeHintCells([], 4, CELL_WIDTH)

    expect(cells).toHaveLength(4)
    expect(cells.every((c) => c.y === 0)).toBe(true)
    expect(cells[3]).toEqual({ x: 780, y: 0, width: 244, height: 120 })
  })

  it("clips a placement that overhangs the grid instead of marking cells outside it", () => {
    // The engine never emits this, but the desktop clips defensively and so does the port.
    const cells = computeHintCells([p(3, 0, 2, 1)], 4, CELL_WIDTH)

    const rowZero = cells.filter((c) => c.y === 0)
    expect(rowZero.map((c) => c.x)).toEqual([0, 260, 520])
    expect(cells).toHaveLength(7)
  })
})

describe("freeCells", () => {
  it("reports grid coordinates, which is what a CSS-sized board positions from", () => {
    // The renderer never sees a column width, so this is the form it consumes; computeHintCells is
    // the same derivation projected onto a measured board.
    expect(freeCells([p(0, 0, 2, 1)], 2)).toEqual([
      { column: 0, row: 1 },
      { column: 1, row: 1 },
    ])
  })
})
