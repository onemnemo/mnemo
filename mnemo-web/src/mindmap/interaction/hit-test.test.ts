import { describe, expect, it } from "vitest"

import { distanceToSegment, hitEdge } from "./hit-test"
import type { ElementBox } from "../canvas/edge-paths"
import type { SceneEdge } from "../model/scene"

const boxes: Record<string, ElementBox> = {
  a: { x: 0, y: 0, width: 100, height: 40 },
  b: { x: 300, y: 0, width: 100, height: 40 },
  c: { x: 300, y: 200, width: 100, height: 40 },
  far: { x: 4000, y: 4000, width: 100, height: 40 },
}

const boxOf = (id: string) => boxes[id]

const edge = (id: string, fromId: string, toId: string, extra: Partial<SceneEdge> = {}): SceneEdge => ({
  id,
  fromId,
  toId,
  kind: "hierarchy",
  ...extra,
})

describe("finding the edge under a point", () => {
  it("finds a straight edge along its length", () => {
    const straight = edge("s", "a", "b", { routing: "straight" })
    // Both boxes are 40 tall at y = 0, so the line runs at y = 20 between them.
    expect(hitEdge({ edges: [straight], boxOf, point: { x: 200, y: 20 }, tolerance: 6 })).toBe("s")
  })

  it("misses when the point is past the tolerance", () => {
    const straight = edge("s", "a", "b", { routing: "straight" })
    expect(hitEdge({ edges: [straight], boxOf, point: { x: 200, y: 40 }, tolerance: 6 })).toBeNull()
  })

  it("follows a curve rather than the chord between its ends", () => {
    // Leaves a's right edge at (100, 20) and enters c's left edge at (300, 220), bowing flat before
    // it turns. A quarter of the way along the chord is (150, 70); the curve is up at about y = 41
    // there, which is a miss at a click's tolerance and a hit at the curve's own height. The
    // midpoints are deliberately not used: the S is symmetric and passes through the chord's.
    const curved = edge("c", "a", "c", { routing: "curve" })

    expect(hitEdge({ edges: [curved], boxOf, point: { x: 150, y: 70 }, tolerance: 6 })).toBeNull()
    expect(hitEdge({ edges: [curved], boxOf, point: { x: 150, y: 41 }, tolerance: 6 })).toBe("c")
  })

  it("takes the nearest when several are in range", () => {
    // Edges leaving one parent share a start point, so first-match would always answer with
    // whichever happened to be earlier in the document.
    const up = edge("up", "a", "b", { routing: "straight" })
    const down = edge("down", "a", "c", { routing: "straight" })

    expect(hitEdge({ edges: [up, down], boxOf, point: { x: 320, y: 25 }, tolerance: 400 })).toBe("up")
  })

  it("ignores an edge whose endpoint is gone", () => {
    expect(
      hitEdge({ edges: [edge("x", "a", "missing")], boxOf, point: { x: 200, y: 20 }, tolerance: 50 }),
    ).toBeNull()
  })

  it("rejects on the bounding box before measuring", () => {
    expect(
      hitEdge({ edges: [edge("x", "far", "far")], boxOf, point: { x: 0, y: 0 }, tolerance: 6 }),
    ).toBeNull()
  })
})

describe("distance to a segment", () => {
  it("clamps to the ends rather than measuring to the infinite line", () => {
    const a = { x: 0, y: 0 }
    const b = { x: 10, y: 0 }

    expect(distanceToSegment(a, b, { x: 5, y: 3 })).toBeCloseTo(3, 6)
    expect(distanceToSegment(a, b, { x: 20, y: 0 })).toBeCloseTo(10, 6)
  })

  it("survives a zero-length segment", () => {
    expect(distanceToSegment({ x: 4, y: 4 }, { x: 4, y: 4 }, { x: 4, y: 7 })).toBeCloseTo(3, 6)
  })
})
