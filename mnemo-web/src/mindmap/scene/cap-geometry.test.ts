import { describe, expect, it } from "vitest"

import { arrowCapPoints, DOT_MARKER } from "./cap-geometry"
import { extentOf } from "./line-geometry"

describe("cap geometry", () => {
  it("keeps maximum-weight arrow points inside the recorded extent at every angle", () => {
    const thickness = 12
    const extent = extentOf([{ x: 0, y: 0 }], thickness, "arrow", "arrow")

    for (const angle of [0, Math.PI / 4, Math.PI / 2, 3 * Math.PI / 4, Math.PI]) {
      for (const point of arrowCapPoints({ x: 0, y: 0, angle }, thickness)) {
        expect(point.x).toBeGreaterThanOrEqual(extent.minX)
        expect(point.x).toBeLessThanOrEqual(extent.maxX)
        expect(point.y).toBeGreaterThanOrEqual(extent.minY)
        expect(point.y).toBeLessThanOrEqual(extent.maxY)
      }
    }
  })

  it("uses the marker's dot radius in canvas units", () => {
    expect(DOT_MARKER.radius * DOT_MARKER.scale).toBe(1.6)
  })
})
