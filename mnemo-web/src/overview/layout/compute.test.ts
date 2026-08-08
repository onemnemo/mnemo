// The board-level pass. Numbers here are derived from the desktop's own constants: at 1024px the
// board is 4 columns of (1024 - 3*16)/4 = 244px, so the horizontal cell pitch is 260 and the
// vertical pitch is 120 + 16 = 136.

import { describe, expect, it } from "vitest"

import { computeLayout, computePlacements, extentHeightForRows, type ChildDesc } from "./compute"

function child(column: number, row: number, columns: number, rows: number): ChildDesc {
  return { column, row, size: { columns, rows } }
}

describe("computePlacements", () => {
  const children = [child(0, 0, 2, 1), child(3, 2, 1, 2), child(0, 0, 1, 1)]

  // The renderer sizes its columns in CSS and asks for placement by column count alone, so the two
  // entry points have to stay one algorithm. Anything that made them diverge would move tiles on
  // screen while every computeLayout test above stayed green.
  it.each([4, 2, 1])("agrees with computeLayout at %i columns", (columnCount) => {
    const width = { 4: 1024, 2: 800, 1: 400 }[columnCount] as number

    expect(computePlacements(children, columnCount, -1)).toEqual(computeLayout(width, children, -1, false).placements)
  })

  it("carries the drag anchor through, like the width-based pass", () => {
    const pinned = [child(0, 0, 2, 1), child(0, 0, 2, 1)]

    expect(computePlacements(pinned, 4, 1)[1]).toEqual({ column: 0, row: 0, columnSpan: 2, rowSpan: 1 })
  })
})

describe("extentHeightForRows", () => {
  it("counts a gap between rows but none after the last", () => {
    expect(extentHeightForRows(1)).toBe(120)
    expect(extentHeightForRows(3)).toBe(392)
  })

  it("is zero for a board with no rows, rather than a negative gap", () => {
    expect(extentHeightForRows(0)).toBe(0)
    expect(extentHeightForRows(-1)).toBe(0)
  })
})

describe("computeLayout rect math", () => {
  it("places a tile at its cell pitch and sizes it across the gaps it spans", () => {
    const { rects, cellWidth, columnCount } = computeLayout(1024, [child(1, 2, 2, 1)], -1, false)

    expect(columnCount).toBe(4)
    expect(cellWidth).toBe(244)
    expect(rects[0]).toEqual({ x: 260, y: 272, width: 504, height: 120 })
  })

  it("adds the row gap into a multi-row height", () => {
    const { rects } = computeLayout(1024, [child(0, 0, 1, 2)], -1, false)

    expect(rects[0]).toEqual({ x: 0, y: 0, width: 244, height: 256 })
  })
})

describe("computeLayout extent", () => {
  it("reports the bottom of the lowest tile", () => {
    const { extentHeight, usedRows } = computeLayout(1024, [child(0, 0, 1, 1), child(0, 2, 1, 1)], -1, false)

    expect(extentHeight).toBe(392)
    expect(usedRows).toBe(3)
  })

  it("adds a gap and one growth row in edit mode", () => {
    const { extentHeight, usedRows } = computeLayout(1024, [child(0, 0, 1, 2)], -1, true)

    // 256 of content, then the gap, then a full empty row to drop onto.
    expect(extentHeight).toBe(392)
    // The growth row is height only; targeting still sees two used rows.
    expect(usedRows).toBe(2)
  })

  it("is zero for an empty board", () => {
    const { rects, placements, extentHeight, usedRows } = computeLayout(1024, [], -1, false)

    expect(rects).toEqual([])
    expect(placements).toEqual([])
    expect(extentHeight).toBe(0)
    expect(usedRows).toBe(0)
  })

  it("gives an empty board in edit mode one row and no leading gap", () => {
    const { extentHeight } = computeLayout(1024, [], -1, true)

    expect(extentHeight).toBe(120)
  })
})

describe("computeLayout breakpoints", () => {
  it("switches column count at 1024 and 560", () => {
    expect(computeLayout(1024, [], -1, false).columnCount).toBe(4)
    expect(computeLayout(1023, [], -1, false).columnCount).toBe(2)
    expect(computeLayout(560, [], -1, false).columnCount).toBe(2)
    expect(computeLayout(559, [], -1, false).columnCount).toBe(1)
  })

  it("honours stored coordinates at the widest breakpoint", () => {
    const children = [child(0, 0, 1, 1), child(3, 2, 1, 1)]
    const { placements, extentHeight } = computeLayout(1024, children, -1, false)

    expect(placements[0]).toEqual({ column: 0, row: 0, columnSpan: 1, rowSpan: 1 })
    expect(placements[1]).toEqual({ column: 3, row: 2, columnSpan: 1, rowSpan: 1 })
    expect(extentHeight).toBe(392)
  })

  it("discards stored coordinates below the widest breakpoint and flow-packs instead", () => {
    const children = [child(0, 0, 1, 1), child(3, 2, 1, 1)]
    const { placements, rects, cellWidth, usedRows } = computeLayout(800, children, -1, false)

    // The second tile's stored (3,2) cannot exist in a 2-column grid, so it compacts up beside the
    // first one instead of leaving two empty rows.
    expect(cellWidth).toBe(392)
    expect(placements[0]).toEqual({ column: 0, row: 0, columnSpan: 1, rowSpan: 1 })
    expect(placements[1]).toEqual({ column: 1, row: 0, columnSpan: 1, rowSpan: 1 })
    expect(rects[1]).toEqual({ x: 408, y: 0, width: 392, height: 120 })
    expect(usedRows).toBe(1)
  })

  it("clamps a span wider than the breakpoint's grid", () => {
    const { placements, rects } = computeLayout(800, [child(0, 0, 4, 1)], -1, false)

    expect(placements[0].columnSpan).toBe(2)
    expect(rects[0].width).toBe(800)
  })
})

describe("computeLayout anchor", () => {
  it("lets the anchor keep its cell at the widest breakpoint", () => {
    const children = [child(0, 0, 2, 1), child(0, 0, 2, 1)]
    const { placements } = computeLayout(1024, children, 1, false)

    expect(placements[1]).toEqual({ column: 0, row: 0, columnSpan: 2, rowSpan: 1 })
    expect(placements[0]).toEqual({ column: 0, row: 1, columnSpan: 2, rowSpan: 1 })
  })

  it("ignores the anchor below the widest breakpoint, as the desktop does", () => {
    const children = [child(0, 0, 2, 1), child(0, 0, 2, 1)]
    const { placements } = computeLayout(800, children, 1, false)

    // Flow packing has no notion of a winning cell: child order decides, so the anchor does not
    // take row 0 away from index 0.
    expect(placements[0]).toEqual({ column: 0, row: 0, columnSpan: 2, rowSpan: 1 })
    expect(placements[1]).toEqual({ column: 0, row: 1, columnSpan: 2, rowSpan: 1 })
  })
})

describe("computeLayout degenerate widths", () => {
  // 1200 falls in the widest bucket, so an unmeasured board lays out as 4 columns of
  // (1200 - 48)/4 = 288 rather than collapsing to one column and re-flowing a frame later.
  it.each([0, -50, Number.NaN, Number.POSITIVE_INFINITY])("falls back to 1200 for width %s", (width) => {
    const { columnCount, cellWidth, rects } = computeLayout(width, [child(0, 0, 1, 1)], -1, false)

    expect(columnCount).toBe(4)
    expect(cellWidth).toBe(288)
    expect(rects[0]).toEqual({ x: 0, y: 0, width: 288, height: 120 })
  })
})
