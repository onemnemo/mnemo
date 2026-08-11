import { describe, expect, it } from "vitest"

import { boundsOf, fitZoom, MIN_SCALE, type SceneElement } from "./scene"

const element = (x: number, y: number, width: number, height: number): SceneElement => ({
  id: `${x},${y}`,
  kind: "node",
  content: { $type: "text", text: "n" },
  x,
  y,
  width,
  height,
  depth: 0,
  branch: -1,
  nodeShape: "card",
  text: { lines: ["n"], fontSize: 14, fontWeight: 500, lineHeight: 19, letterSpacing: "0" },
  padding: { x: 11, y: 7 },
  isRoot: true,
  childCount: 0,
  hiddenCount: 0,
})

describe("bounds", () => {
  it("covers every element's far corner, not just its origin", () => {
    expect(boundsOf([element(0, 0, 100, 40), element(300, 200, 60, 30)])).toEqual({
      minX: 0,
      minY: 0,
      maxX: 360,
      maxY: 230,
    })
  })
})

describe("fit", () => {
  it("shrinks a map too large for the viewport", () => {
    const { zoom } = fitZoom({ minX: 0, minY: 0, maxX: 2000, maxY: 1000 }, 1000, 500)

    expect(zoom).toBeLessThan(1)
  })

  it("never magnifies a map that already fits", () => {
    // A brand new map is one node. Blowing it up to fill the window is zooming, not fitting, and it
    // is what opening a fresh map used to do.
    const { zoom } = fitZoom({ minX: 0, minY: 0, maxX: 140, maxY: 40 }, 1280, 520)

    expect(zoom).toBe(1)
  })

  it("takes the tighter of the two axes", () => {
    // Wide and short against a square viewport: width decides.
    const { zoom } = fitZoom({ minX: 0, minY: 0, maxX: 4000, maxY: 100 }, 1000, 1000)

    expect(zoom).toBeCloseTo((1000 * 0.95) / 4000, 6)
  })

  it("says so when a map is too large to show whole", () => {
    // The floor exists because a five-thousand node tree needs about 0.007 to fit; the desktop stops
    // an order of magnitude short and silently shows a corner.
    const fit = fitZoom({ minX: 0, minY: 0, maxX: 400_000, maxY: 400_000 }, 1000, 500)

    expect(fit.zoom).toBe(MIN_SCALE)
    expect(fit.clampedToFloor).toBe(true)
  })

  it("leaves an empty or degenerate map at 1:1 rather than dividing by zero", () => {
    expect(fitZoom({ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }, 800, 600).zoom).toBe(1)
    expect(fitZoom({ minX: 10, minY: 10, maxX: 10, maxY: 10 }, 800, 600).zoom).toBe(1)
  })
})
