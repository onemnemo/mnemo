import { describe, expect, it } from "vitest"

import { backgroundStep } from "./runtime"
import { MAX_SCALE, MIN_SCALE } from "../model/scene"

describe("backgroundStep", () => {
  it("leaves the tile alone at the zoom it was authored for", () => {
    expect(backgroundStep(1)).toBe(24)
    expect(backgroundStep(2)).toBe(48)
    expect(backgroundStep(MAX_SCALE)).toBe(120)
  })

  it("never lets the tile fall below a readable size, right down to the camera floor", () => {
    // The reported failure: a fixed tile lands at 0.48px at the floor, which crowds, then washes the
    // whole pane in line colour, then beats against the pixel grid, then vanishes.
    for (let zoom = MIN_SCALE; zoom <= MAX_SCALE; zoom *= 1.05) {
      expect(backgroundStep(zoom)).toBeGreaterThanOrEqual(18)
    }
    expect(backgroundStep(MIN_SCALE)).toBeGreaterThanOrEqual(18)
  })

  it("keeps a zoomed-out tile inside one doubling, so the grid never reads as sparse either", () => {
    for (let zoom = MIN_SCALE; zoom <= 1; zoom *= 1.05) {
      expect(backgroundStep(zoom)).toBeLessThan(36)
    }
  })

  it("only ever coarsens by whole doublings, so lines stay on the positions they marked", () => {
    // Every coarser tile has to be a multiple of the base one in world units, or zooming out slides
    // the grid off the map it was drawn under.
    for (let zoom = MIN_SCALE; zoom <= MAX_SCALE; zoom *= 1.05) {
      const doublings = Math.log2(backgroundStep(zoom) / zoom / 24)
      expect(Math.abs(doublings - Math.round(doublings))).toBeLessThan(1e-9)
      expect(Math.round(doublings)).toBeGreaterThanOrEqual(0)
    }
  })

  it("holds a sane tile when the camera has no size yet", () => {
    expect(backgroundStep(0)).toBe(24)
  })
})
