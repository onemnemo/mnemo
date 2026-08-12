/**
 * The align and distribute geometry.
 *
 * The numbers are the desktop's, asserted rather than described, because two boxes lined up in either
 * app have to end up in the same place. The idempotence cases matter as much as the arithmetic: a
 * button that returned a move for something already in position would put an empty step on the undo
 * stack every time it was pressed.
 */

import { describe, expect, it } from "vitest"

import { computeAlign, type AlignBox, type AlignMove } from "./align"

const box = (id: string, x: number, y: number, width = 20, height = 10): AlignBox => ({ id, x, y, width, height })

const moved = (moves: readonly AlignMove[], id: string): boolean => moves.some((move) => move.id === id)

const at = (moves: readonly AlignMove[], id: string): AlignMove => {
  const found = moves.find((move) => move.id === id)
  if (!found) throw new Error(`${id} did not move`)
  return found
}

describe("lining up against an edge", () => {
  it("takes everything to the leftmost edge without touching how far down it sits", () => {
    const moves = computeAlign("left", [box("a", 0, 5), box("b", 40, 30), box("c", 100, 80)])

    expect(moved(moves, "a")).toBe(false)
    expect(at(moves, "b")).toEqual({ id: "b", x: 0, y: 30 })
    expect(at(moves, "c")).toEqual({ id: "c", x: 0, y: 80 })
  })

  it("puts right edges flush, which is a different move per width", () => {
    // The rightmost edge is c's, at 110. Each box lands at 110 minus its own width.
    const moves = computeAlign("right", [box("a", 0, 0, 20), box("b", 50, 0, 40), box("c", 100, 0, 10)])

    expect(at(moves, "a").x).toBe(90)
    expect(at(moves, "b").x).toBe(70)
    expect(moved(moves, "c")).toBe(false)
  })

  it("takes everything to the topmost edge without touching how far across it sits", () => {
    const moves = computeAlign("top", [box("a", 5, 0), box("b", 40, 40), box("c", 90, 70)])

    expect(moved(moves, "a")).toBe(false)
    expect(at(moves, "b")).toEqual({ id: "b", x: 40, y: 0 })
    expect(at(moves, "c")).toEqual({ id: "c", x: 90, y: 0 })
  })

  it("puts bottom edges flush, which is a different move per height", () => {
    const moves = computeAlign("bottom", [box("a", 0, 0, 20, 10), box("b", 0, 20, 20, 40), box("c", 0, 30, 20, 10)])

    expect(at(moves, "a").y).toBe(50)
    expect(moved(moves, "b")).toBe(false)
    expect(at(moves, "c").y).toBe(50)
  })
})

describe("centring on the selection", () => {
  it("centres across the whole extent, not on any one box", () => {
    const moves = computeAlign("centerHorizontal", [box("a", 0, 0, 20), box("b", 80, 0, 20)])

    // Extent 0..100, so the midline is 50 and each 20-wide box starts 10 short of it.
    expect(at(moves, "a").x).toBe(40)
    expect(at(moves, "b").x).toBe(40)
  })

  it("does the same down the other axis", () => {
    const moves = computeAlign("middleVertical", [box("a", 0, 0, 20, 10), box("b", 0, 90, 20, 10)])

    expect(at(moves, "a").y).toBe(45)
    expect(at(moves, "b").y).toBe(45)
  })
})

describe("spreading a row out evenly", () => {
  it("equalises the gaps between boxes of different widths", () => {
    const moves = computeAlign("distributeHorizontal", [
      box("a", 0, 0, 20),
      box("b", 30, 0, 40),
      box("c", 150, 0, 10),
      box("d", 200, 0, 20),
    ])

    // 180 of space between the anchors, 50 of it taken by the two interior boxes.
    const gap = (180 - 50) / 3
    expect(at(moves, "b").x).toBeCloseTo(20 + gap, 6)
    expect(at(moves, "c").x).toBeCloseTo(20 + gap + 40 + gap, 6)
    expect(moved(moves, "a")).toBe(false)
    expect(moved(moves, "d")).toBe(false)
  })

  it("leaves the same gap between every pair once it has run", () => {
    const boxes = [box("a", 0, 0, 20), box("b", 30, 0, 40), box("c", 150, 0, 10), box("d", 200, 0, 20)]
    const moves = computeAlign("distributeHorizontal", boxes)

    const placed = boxes
      .map((original) => {
        const move = moves.find((candidate) => candidate.id === original.id)
        return move ? { ...original, x: move.x } : original
      })
      .sort((one, other) => one.x - other.x)

    const gaps = placed.slice(1).map((next, index) => next.x - (placed[index].x + placed[index].width))
    for (const gap of gaps) {
      expect(gap).toBeCloseTo(gaps[0], 6)
    }
  })

  it("equalises the gaps down the other axis too", () => {
    const moves = computeAlign("distributeVertical", [
      box("a", 0, 0, 20, 10),
      box("b", 0, 30, 20, 30),
      box("c", 0, 150, 20, 10),
      box("d", 0, 200, 20, 10),
    ])

    const gap = (190 - 40) / 3
    expect(at(moves, "b").y).toBeCloseTo(10 + gap, 6)
    expect(at(moves, "c").y).toBeCloseTo(10 + gap + 30 + gap, 6)
    expect(moved(moves, "a")).toBe(false)
    expect(moved(moves, "d")).toBe(false)
  })

  it("orders two boxes at the same coordinate the same way whichever order they arrive in", () => {
    const tied = [box("a", 0, 0, 10), box("m", 50, 0, 10), box("n", 50, 0, 10), box("z", 200, 0, 10)]
    const forwards = computeAlign("distributeHorizontal", tied)
    const backwards = computeAlign("distributeHorizontal", [...tied].reverse())

    expect(new Map(backwards.map((move) => [move.id, move.x]))).toEqual(
      new Map(forwards.map((move) => [move.id, move.x])),
    )
  })
})

describe("what does not count as an edit", () => {
  it("moves nothing when there is nothing to line up against", () => {
    expect(computeAlign("left", [box("a", 10, 10)])).toEqual([])
    expect(computeAlign("centerHorizontal", [])).toEqual([])
  })

  it("has nothing to spread with only the two anchors", () => {
    const pair = [box("a", 0, 0), box("b", 100, 0)]

    expect(computeAlign("distributeHorizontal", pair)).toEqual([])
    expect(computeAlign("distributeVertical", pair)).toEqual([])
  })

  it("returns nothing at all for boxes that are already where the op would put them", () => {
    expect(computeAlign("left", [box("a", 5, 0), box("b", 5, 40), box("c", 5, 80)])).toEqual([])
    expect(
      computeAlign("distributeHorizontal", [box("a", 0, 0, 10), box("b", 45, 0, 10), box("c", 90, 0, 10)]),
    ).toEqual([])
  })
})
