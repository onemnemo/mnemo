// @vitest-environment jsdom

import { describe, expect, it } from "vitest"

import { backgroundStep, createCanvasRuntime, type CanvasElements, type CanvasRuntimeOptions } from "./runtime"
import { MAX_SCALE, MIN_SCALE, type Scene, type SceneElement } from "../model/scene"

function element(id: string, over: Partial<SceneElement> = {}): SceneElement {
  return {
    id,
    kind: "node",
    content: { $type: "text", text: id },
    x: 0,
    y: 0,
    width: 100,
    height: 40,
    depth: 0,
    branch: -1,
    nodeShape: "card",
    text: { lines: [id], fontSize: 14, fontWeight: 500, lineHeight: 19, letterSpacing: "-0.005em" },
    padding: { x: 11, y: 7 },
    isRoot: true,
    childCount: 0,
    hiddenCount: 0,
    ...over,
  }
}

/**
 * A runtime over a pane sized like a real one, on the SVG edge substrate so nothing here ever
 * touches a canvas 2D context, which jsdom does not implement.
 */
function mount(scene: Scene, over: Partial<CanvasRuntimeOptions> = {}) {
  const pane = document.createElement("div")
  document.body.append(pane)
  pane.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600)
  Object.defineProperty(pane, "clientWidth", { value: 800, configurable: true })
  Object.defineProperty(pane, "clientHeight", { value: 600, configurable: true })

  const world = document.createElement("div")
  pane.append(world)

  const elements: CanvasElements = { pane, world, background: null, edgeCamera: null, edgeCanvas: null }

  const runtime = createCanvasRuntime({ scene, elements, edgeMode: "svg", strategy: "svg", ...over })

  return {
    runtime,
    pane,
    dispose: () => {
      runtime.dispose()
      pane.remove()
    },
  }
}

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

const EMPTY_SCENE: Scene = { id: "m", elements: [], edges: [], background: "dots" }

describe("the wheel", () => {
  it("pans on a plain wheel, the way trackpad scroll reads everywhere else", () => {
    const { runtime, pane, dispose } = mount(EMPTY_SCENE)

    pane.dispatchEvent(
      new WheelEvent("wheel", {
        deltaX: 20,
        deltaY: 30,
        clientX: 0,
        clientY: 0,
        cancelable: true,
        bubbles: true,
      }),
    )

    expect(runtime.viewport()).toEqual({ x: 20, y: 30, zoom: 1 })
    dispose()
  })

  it("zooms instead when ctrl is held, which is how a trackpad pinch is delivered", () => {
    const { runtime, pane, dispose } = mount(EMPTY_SCENE)
    const before = runtime.viewport()

    pane.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: -100,
        clientX: 0,
        clientY: 0,
        ctrlKey: true,
        cancelable: true,
        bubbles: true,
      }),
    )

    const after = runtime.viewport()
    expect(after.zoom).toBeGreaterThan(before.zoom)
    // Anchored on the point under the cursor, which sat at the pane's own top-left corner here, so
    // that point does not slide.
    expect(after.x).toBe(before.x)
    expect(after.y).toBe(before.y)
    dispose()
  })
})

describe("fit", () => {
  it("says nothing when the whole map fits with room to spare", () => {
    let clamped = 0
    const { runtime, dispose } = mount(
      { id: "m", elements: [element("a", { width: 100, height: 100 })], edges: [], background: "dots" },
      { onFitClamped: () => void (clamped += 1) },
    )

    runtime.fit()

    expect(clamped).toBe(0)
    expect(runtime.viewport().zoom).toBe(1)
    dispose()
  })

  it("reports the clamp when a map is too large to ever show whole", () => {
    let clamped = 0
    const { runtime, dispose } = mount(
      {
        id: "m",
        elements: [element("a", { width: 100000, height: 100000 })],
        edges: [],
        background: "dots",
      },
      { onFitClamped: () => void (clamped += 1) },
    )

    runtime.fit()

    expect(clamped).toBe(1)
    expect(runtime.viewport().zoom).toBe(MIN_SCALE)
    dispose()
  })
})
