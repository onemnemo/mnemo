import { describe, expect, it } from "vitest"

import { anchorsFor, edgeShape } from "../canvas/edge-paths"
import {
  BAR_DOCK_CLEARANCE,
  BAR_GAP,
  BAR_LIFT,
  boxesAnchor,
  clampBar,
  edgeAnchor,
  nextPlacement,
} from "./anchor"

const BAR = { width: 300, height: 40 }
const PANE = { width: 1000, height: 700 }

function box(x: number, y: number, width = 100, height = 40) {
  return { x, y, width, height }
}

describe("clampBar", () => {
  it("sits the bar's bottom edge above the point, by the lift", () => {
    expect(clampBar({ x: 500, y: 400 }, BAR, PANE)).toEqual({ x: 500, y: 400 - BAR_LIFT })
  })

  it("keeps a bar over something near the left edge fully on the pane", () => {
    const placed = clampBar({ x: 10, y: 400 }, BAR, PANE)

    // The anchor is the bar's centre, so the left edge is half a bar to the left of it.
    expect(placed.x - BAR.width / 2).toBeGreaterThanOrEqual(0)
  })

  it("keeps a bar over something near the right edge fully on the pane", () => {
    const placed = clampBar({ x: 990, y: 400 }, BAR, PANE)

    expect(placed.x + BAR.width / 2).toBeLessThanOrEqual(PANE.width)
  })

  it("drops a bar over something at the top down far enough to be seen", () => {
    const placed = clampBar({ x: 500, y: 4 }, BAR, PANE)

    // The anchor is the bar's bottom, so a bar at the very top needs a whole bar's height below it.
    expect(placed.y).toBe(BAR.height + BAR_GAP)
  })

  it("keeps a bar over something at the bottom clear of the dock", () => {
    const placed = clampBar({ x: 500, y: 699 }, BAR, PANE)

    expect(placed.y).toBe(PANE.height - BAR_DOCK_CLEARANCE)
  })

  it("puts the bar on the pane rather than off it when the pane is smaller than the bar", () => {
    // A window dragged short has no position that satisfies both limits. Being visible at the top
    // beats being correct about the dock and gone.
    const placed = clampBar({ x: 40, y: 30 }, BAR, { width: 120, height: 80 })

    expect(placed).toEqual({ x: BAR.width / 2 + BAR_GAP, y: BAR.height + BAR_GAP })
  })
})

describe("nextPlacement", () => {
  const sizes = { bar: BAR, pane: PANE }
  const toPane = (point: { x: number; y: number }) => ({ x: point.x * 2, y: point.y * 2 })

  it("places on the first frame, with nothing to compare against", () => {
    const next = nextPlacement({ world: { x: 100, y: 100 }, toPane, measure: () => sizes, last: null })

    expect(next).toEqual({ anchor: { x: 200, y: 200 }, at: { x: 200, y: 200 - BAR_LIFT } })
  })

  it("writes nothing when there is nothing to sit over", () => {
    expect(nextPlacement({ world: null, toPane, measure: () => sizes, last: null })).toBeNull()
  })

  it("writes nothing on a frame where the anchor has not moved", () => {
    const next = nextPlacement({
      world: { x: 100, y: 100 },
      toPane,
      measure: () => sizes,
      last: { x: 200, y: 200 },
    })

    expect(next).toBeNull()
  })

  it("does not measure on a frame it is not going to write", () => {
    // The whole idle cost of following a map that is sitting still. Reading a size is a layout read,
    // and the great majority of frames are frames where nothing moved.
    let measured = 0
    const measure = () => {
      measured += 1
      return sizes
    }

    nextPlacement({ world: { x: 100, y: 100 }, toPane, measure, last: { x: 200, y: 200 } })
    expect(measured).toBe(0)

    nextPlacement({ world: { x: 101, y: 100 }, toPane, measure, last: { x: 200, y: 200 } })
    expect(measured).toBe(1)
  })

  it("compares the unclamped anchor, not where the bar ended up", () => {
    // A bar pinned against the top of the pane has the same position for a range of anchors. If the
    // clamped value were what got remembered, the bar would stay stuck there after the map moved
    // back down, because the comparison would keep saying nothing changed.
    const first = nextPlacement({ world: { x: 100, y: 1 }, toPane, measure: () => sizes, last: null })
    const second = nextPlacement({ world: { x: 100, y: 4 }, toPane, measure: () => sizes, last: first!.anchor })

    expect(first!.at).toEqual(second!.at)
    expect(second!.anchor).not.toEqual(first!.anchor)
  })
})

describe("boxesAnchor", () => {
  it("has nothing to say about an empty selection", () => {
    expect(boxesAnchor([])).toBeNull()
  })

  it("hangs over the top centre of one box", () => {
    expect(boxesAnchor([box(100, 200)])).toEqual({ x: 150, y: 200 })
  })

  it("spans every box, including one that sits above the rest", () => {
    const anchor = boxesAnchor([box(100, 300), box(500, 180), box(300, 400)])

    expect(anchor).toEqual({ x: (100 + 600) / 2, y: 180 })
  })
})

describe("edgeAnchor", () => {
  const from = box(0, 0)
  const to = box(400, 300)

  it("hangs a straight run's bar over the middle of the run", () => {
    expect(edgeAnchor("straight", from, to)).toEqual({ x: 250, y: 170 })
  })

  it("puts every routing where that routing's own label goes", () => {
    // All three agree today, which is a property of the geometry rather than a coincidence: a
    // symmetric cubic's midpoint and an elbow's bend both land on the mean of the anchors. The bar
    // asks the shape anyway, so it stays on the label if the geometry ever stops agreeing.
    for (const routing of ["curve", "straight", "orthogonal"] as const) {
      const anchor = edgeAnchor(routing, from, to)
      expect(anchor).toEqual(edgeShape(routing, anchorsFor(from, to)).label)
    }
  })
})
