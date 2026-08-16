// A case-for-case transcription of Mnemo.Infrastructure.Tests/Widgets/WidgetLayoutEngineTests.cs.
// Each test keeps the C# method name so the two suites can be diffed by eye, and keeps the same
// setup numbers and expectations. The C# value types are readonly record structs, so Assert.Equal
// compares field by field; toEqual against plain objects is the equivalent here.

import { describe, expect, it } from "vitest"

import { pack, resolve, type DesiredPlacement, type WidgetPlacement, type WidgetSize } from "./engine"

/** The C# test file's S(columns, rows) helper. */
function s(columns: number, rows: number): WidgetSize {
  return { columns, rows }
}

/** The C# test file's D(column, row, columns, rows) helper. */
function d(column: number, row: number, columns: number, rows: number): DesiredPlacement {
  return { column, row, size: { columns, rows } }
}

/** The C# expectation `new WidgetPlacement(column, row, columnSpan, rowSpan)`. */
function p(column: number, row: number, columnSpan: number, rowSpan: number): WidgetPlacement {
  return { column, row, columnSpan, rowSpan }
}

/**
 * The shared body of the two NeverOverlap tests: every cell of every placement's full footprint is
 * claimed exactly once, and no column escapes the grid. Checking only the top-left corners would
 * accept overlapping placements, which is the mistake the C# test is written to catch.
 */
function expectNoOverlap(placements: readonly WidgetPlacement[], maxColumn: number): void {
  const occupied = new Set<string>()
  for (const placement of placements) {
    for (let r = placement.row; r < placement.row + placement.rowSpan; r++) {
      for (let c = placement.column; c < placement.column + placement.columnSpan; c++) {
        const cell = `${String(c)},${String(r)}`
        expect(occupied.has(cell), `Cell (${String(c)},${String(r)}) is occupied twice.`).toBe(false)
        occupied.add(cell)
        expect(c).toBeGreaterThanOrEqual(0)
        expect(c).toBeLessThanOrEqual(maxColumn)
      }
    }
  }
}

describe("pack", () => {
  it("Pack_EmptyInput_ReturnsEmpty", () => {
    expect(pack([], 4)).toEqual([])
  })

  it("Pack_SingleWidget_PlacedTopLeft", () => {
    const placements = pack([s(2, 1)], 4)
    expect(placements[0]).toEqual(p(0, 0, 2, 1))
  })

  it("Pack_FlowsLeftToRightThenWraps", () => {
    const placements = pack([s(2, 1), s(1, 1), s(1, 1), s(2, 2)], 4)

    expect(placements[0]).toEqual(p(0, 0, 2, 1))
    expect(placements[1]).toEqual(p(2, 0, 1, 1))
    expect(placements[2]).toEqual(p(3, 0, 1, 1))
    expect(placements[3]).toEqual(p(0, 1, 2, 2))
  })

  it("Pack_Dense_FillsHolesLeftByWideWidgets", () => {
    // A 3-wide widget leaves a 1-wide hole in row 0; the 2-wide widget wraps to row 1,
    // and the later 1x1 must backfill the hole (grid-auto-flow: dense semantics).
    const placements = pack([s(3, 1), s(2, 1), s(1, 1)], 4)

    expect(placements[0]).toEqual(p(0, 0, 3, 1))
    expect(placements[1]).toEqual(p(0, 1, 2, 1))
    expect(placements[2]).toEqual(p(3, 0, 1, 1))
  })

  // [Theory] InlineData(2, 2) and InlineData(1, 1).
  it.each([
    { columnCount: 2, expectedSpan: 2 },
    { columnCount: 1, expectedSpan: 1 },
  ])(
    "Pack_ClampsSpansWiderThanColumnCount (columnCount=$columnCount)",
    ({ columnCount, expectedSpan }) => {
      const placements = pack([s(4, 1)], columnCount)

      expect(placements[0].column).toBe(0)
      expect(placements[0].columnSpan).toBe(expectedSpan)
    },
  )

  it("Pack_SingleColumn_StacksEverything", () => {
    const placements = pack([s(2, 1), s(4, 2), s(1, 1)], 1)

    expect(placements[0]).toEqual(p(0, 0, 1, 1))
    expect(placements[1]).toEqual(p(0, 1, 1, 2))
    expect(placements[2]).toEqual(p(0, 3, 1, 1))
  })

  it("Pack_Reorder_ChangesPlacementsAccordingly", () => {
    const sizes = [s(2, 1), s(2, 1), s(2, 1)]
    const before = pack(sizes, 4)
    expect(before[0]).toEqual(p(0, 0, 2, 1))
    expect(before[1]).toEqual(p(2, 0, 2, 1))
    expect(before[2]).toEqual(p(0, 1, 2, 1))

    // Moving the last widget to the front is a pure input reorder, same slots, new owners.
    const reordered = [sizes[2], sizes[0], sizes[1]]
    const after = pack(reordered, 4)
    expect(after[0]).toEqual(p(0, 0, 2, 1))
    expect(after[1]).toEqual(p(2, 0, 2, 1))
    expect(after[2]).toEqual(p(0, 1, 2, 1))
  })

  it("Pack_Resize_RepacksFollowingWidgets", () => {
    const before = pack([s(2, 1), s(2, 1)], 4)
    expect(before[1]).toEqual(p(2, 0, 2, 1))

    // Growing the first widget to full width pushes the second to the next row.
    const after = pack([s(4, 1), s(2, 1)], 4)
    expect(after[0]).toEqual(p(0, 0, 4, 1))
    expect(after[1]).toEqual(p(0, 1, 2, 1))
  })

  it("Pack_NonPositiveSpans_ClampToOne", () => {
    const placements = pack([s(0, 0)], 4)
    expect(placements[0]).toEqual(p(0, 0, 1, 1))
  })

  it("Pack_PlacementsNeverOverlap", () => {
    const placements = pack([s(2, 2), s(1, 1), s(3, 1), s(2, 1), s(1, 2), s(4, 1), s(1, 1)], 4)

    expectNoOverlap(placements, 3)
  })

  // [Theory] InlineData(0) and InlineData(-1). The C# asserts ArgumentOutOfRangeException; RangeError
  // is its nearest JavaScript equivalent, and the guard runs before the input list is touched.
  it.each([0, -1])("Pack_InvalidColumnCount_Throws (columnCount=%i)", (columnCount) => {
    expect(() => pack([s(1, 1)], columnCount)).toThrow(RangeError)
  })
})

describe("resolve", () => {
  it("Resolve_HonorsStoredCoordinates", () => {
    const placements = resolve([d(2, 0, 2, 1), d(0, 1, 1, 1)], 4)

    expect(placements[0]).toEqual(p(2, 0, 2, 1))
    expect(placements[1]).toEqual(p(0, 1, 1, 1))
  })

  it("Resolve_LeavesGapAbove_NoUpwardCompaction", () => {
    // A lone tile placed in row 3 stays there, the empty rows above it are intentional.
    const placements = resolve([d(0, 3, 1, 1)], 4)

    expect(placements[0]).toEqual(p(0, 3, 1, 1))
  })

  it("Resolve_Overlap_PushesLaterWidgetDown", () => {
    // Two tiles want the same cell; the second in processing order (by row/col) yields downward.
    const placements = resolve([d(0, 0, 2, 2), d(0, 0, 2, 1)], 4)

    expect(placements[0]).toEqual(p(0, 0, 2, 2))
    expect(placements[1]).toEqual(p(0, 2, 2, 1))
  })

  it("Resolve_Anchor_KeepsItsCellWhileOthersYield", () => {
    // The anchor (index 1) is dropped onto index 0's cell; the anchor wins, index 0 pushes down.
    const placements = resolve([d(0, 0, 2, 1), d(0, 0, 2, 1)], 4, 1)

    expect(placements[1]).toEqual(p(0, 0, 2, 1))
    expect(placements[0]).toEqual(p(0, 1, 2, 1))
  })

  it("Resolve_UnassignedCoordinates_DropIntoFirstFreeCell", () => {
    // (-1,-1) means unassigned: placed densely after the positioned widget.
    const placements = resolve([d(0, 0, 2, 1), d(-1, -1, 2, 1)], 4)

    expect(placements[0]).toEqual(p(0, 0, 2, 1))
    expect(placements[1]).toEqual(p(2, 0, 2, 1))
  })

  it("Resolve_ClampsColumnAndSpanToGrid", () => {
    // Column 3 with a 3-wide span cannot fit in a 4-column grid; the column clamps to 1.
    const placements = resolve([d(3, 0, 3, 1)], 4)

    expect(placements[0]).toEqual(p(1, 0, 3, 1))
  })

  it("Resolve_PlacementsNeverOverlap", () => {
    const placements = resolve(
      [d(0, 0, 2, 2), d(1, 0, 2, 1), d(0, 0, 1, 1), d(3, 1, 1, 2), d(2, 2, 2, 1)],
      4,
    )

    expectNoOverlap(placements, 3)
  })

  // [Theory] InlineData(0) and InlineData(-1), same exception mapping as Pack.
  it.each([0, -1])("Resolve_InvalidColumnCount_Throws (columnCount=%i)", (columnCount) => {
    expect(() => resolve([d(0, 0, 1, 1)], columnCount)).toThrow(RangeError)
  })
})
