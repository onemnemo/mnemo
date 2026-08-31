// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"

// Pinned rather than read from the runner: isMac is settled at module load from the host's
// navigator, so an unpinned assertion about the pan modifier tests whichever machine ran it.
vi.mock("@/keybinds/chord", async (original) => ({
  ...(await original<typeof import("@/keybinds/chord")>()),
  isMac: false,
}))

import type { EdgeCanvasContext } from "./edge-canvas"
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
  it("zooms on a plain wheel, with no modifier to reach for", () => {
    const { runtime, pane, dispose } = mount(EMPTY_SCENE)
    const before = runtime.viewport()

    pane.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: -100,
        clientX: 0,
        clientY: 0,
        cancelable: true,
        bubbles: true,
      }),
    )

    expect(runtime.viewport().zoom).toBeGreaterThan(before.zoom)
    dispose()
  })

  it("zooms out on the other direction, so the notch is not one way only", () => {
    const { runtime, pane, dispose } = mount(EMPTY_SCENE)
    const before = runtime.viewport()

    pane.dispatchEvent(
      new WheelEvent("wheel", { deltaY: 100, clientX: 0, clientY: 0, cancelable: true, bubbles: true }),
    )

    expect(runtime.viewport().zoom).toBeLessThan(before.zoom)
    dispose()
  })

  it("takes the page's own scrolling out of it, whichever way it turned", () => {
    const { pane, dispose } = mount(EMPTY_SCENE)

    const event = new WheelEvent("wheel", { deltaY: 100, cancelable: true, bubbles: true })
    pane.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    dispose()
  })

  it("pans on a sideways wheel, which is travel rather than distance", () => {
    const { runtime, pane, dispose } = mount(EMPTY_SCENE)

    pane.dispatchEvent(
      new WheelEvent("wheel", { deltaX: 30, deltaY: 10, cancelable: true, bubbles: true }),
    )

    expect(runtime.viewport()).toEqual({ x: 30, y: 10, zoom: 1 })
    dispose()
  })

  it("pans sideways on shift with a plain wheel, for engines that hand the notch over unturned", () => {
    const { runtime, pane, dispose } = mount(EMPTY_SCENE)

    pane.dispatchEvent(
      new WheelEvent("wheel", { deltaY: 40, shiftKey: true, cancelable: true, bubbles: true }),
    )

    expect(runtime.viewport()).toEqual({ x: 40, y: 0, zoom: 1 })
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

/** A pointer event jsdom will carry a button and a pointer id on. */
function pointer(type: string, init: PointerEventInit = {}): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, { pointerId: 1, button: 0, movementX: 0, movementY: 0, ...init })
  return event
}

describe("panning the map", () => {
  /** jsdom has no pointer capture, and the runtime takes one on every pan. */
  const stubCapture = (pane: HTMLElement) => {
    pane.setPointerCapture = () => {}
    pane.releasePointerCapture = () => {}
  }

  const dragBy = (pane: HTMLElement, down: PointerEventInit, dx: number, dy: number) => {
    pane.dispatchEvent(pointer("pointerdown", down))
    pane.dispatchEvent(pointer("pointermove", { pointerId: 1, movementX: dx, movementY: dy }))
    pane.dispatchEvent(pointer("pointerup", { pointerId: 1 }))
  }

  it("follows a middle button drag", () => {
    const { runtime, pane, dispose } = mount(EMPTY_SCENE)
    stubCapture(pane)

    dragBy(pane, { button: 1 }, 40, 25)

    expect(runtime.viewport()).toEqual({ x: -40, y: -25, zoom: 1 })
    dispose()
  })

  it("keeps the browser's own middle click scrolling from running alongside it", () => {
    const { pane, dispose } = mount(EMPTY_SCENE)

    // The autoscroll starts on the mouse event, so a prevented pointerdown never reaches it and the
    // map would pan while the page slid the other way.
    const event = new MouseEvent("mousedown", { button: 1, cancelable: true, bubbles: true })
    pane.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    dispose()
  })

  it("leaves an ordinary left press alone, which is the marquee's", () => {
    const { pane, dispose } = mount(EMPTY_SCENE)

    const event = pointer("pointerdown", { button: 0 })
    pane.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
    dispose()
  })

  it("follows an alt held left drag", () => {
    const { runtime, pane, dispose } = mount(EMPTY_SCENE)
    stubCapture(pane)

    dragBy(pane, { button: 0, altKey: true }, 10, 10)

    expect(runtime.viewport()).toEqual({ x: -10, y: -10, zoom: 1 })
    dispose()
  })

  it("follows a left drag while space is held, and lets go when it is released", () => {
    const { runtime, pane, dispose } = mount(EMPTY_SCENE)
    stubCapture(pane)

    pane.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true, cancelable: true }))
    dragBy(pane, { button: 0 }, 15, 5)
    expect(runtime.viewport()).toEqual({ x: -15, y: -5, zoom: 1 })

    pane.dispatchEvent(new KeyboardEvent("keyup", { code: "Space", bubbles: true }))
    dragBy(pane, { button: 0 }, 15, 5)

    expect(runtime.viewport()).toEqual({ x: -15, y: -5, zoom: 1 })
    dispose()
  })

  it("hears the space release wherever the focus went, so pan mode cannot latch on", () => {
    const { runtime, pane, dispose } = mount(EMPTY_SCENE)
    stubCapture(pane)

    // Held over the map, released with the focus in a dialog: the key-up never reaches the pane.
    pane.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true, cancelable: true }))
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "Space" }))
    dragBy(pane, { button: 0 }, 15, 5)

    expect(runtime.viewport()).toEqual({ x: 0, y: 0, zoom: 1 })
    dispose()
  })

  it("leaves a press inside an open label field alone, where it is the caret's", () => {
    const { runtime, pane, dispose } = mount(EMPTY_SCENE)
    stubCapture(pane)
    const field = document.createElement("input")
    pane.append(field)

    // The edge-label editor lives outside any node, so without the field guard this press would
    // read as the modifier over empty canvas and pan instead of placing the caret.
    field.dispatchEvent(pointer("pointerdown", { button: 0, ctrlKey: true }))
    pane.dispatchEvent(pointer("pointermove", { pointerId: 1, movementX: 25, movementY: 25 }))

    expect(runtime.viewport()).toEqual({ x: 0, y: 0, zoom: 1 })
    dispose()
  })

  it("does not take the space bar out of a label being typed into", () => {
    const { runtime, pane, dispose } = mount(EMPTY_SCENE)
    stubCapture(pane)
    const field = document.createElement("textarea")
    pane.append(field)

    field.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true, cancelable: true }))
    dragBy(pane, { button: 0 }, 20, 20)

    expect(runtime.viewport()).toEqual({ x: 0, y: 0, zoom: 1 })
    dispose()
  })

  it("follows the primary modifier over empty canvas", () => {
    const { runtime, pane, dispose } = mount(EMPTY_SCENE)
    stubCapture(pane)

    dragBy(pane, { button: 0, ctrlKey: true }, 12, 8)

    expect(runtime.viewport()).toEqual({ x: -12, y: -8, zoom: 1 })
    dispose()
  })

  it("leaves the same press on a node alone, where it still means add to the selection", () => {
    const { runtime, pane, dispose } = mount(EMPTY_SCENE)
    stubCapture(pane)
    const node = document.createElement("div")
    node.className = "mm-node"
    pane.append(node)

    node.dispatchEvent(pointer("pointerdown", { button: 0, ctrlKey: true }))
    pane.dispatchEvent(pointer("pointermove", { pointerId: 1, movementX: 30, movementY: 30 }))

    expect(runtime.viewport()).toEqual({ x: 0, y: 0, zoom: 1 })
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

/**
 * The device pixel ratio, on the substrate that has to be told about it.
 *
 * The SVG layer scales itself and never asks. The canvas one holds a backing store sized in device
 * pixels, and the only thing that ever sized it was the observer on the pane's CSS box. A window
 * dragged from a laptop panel to an external monitor changes the ratio and not that box, so the
 * observer never fires and the map keeps drawing into a surface built for the density it left.
 */
describe("the device pixel ratio", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** Records only what these tests read back; jsdom ships no 2D context to record from. */
  function recorder(): { context: EdgeCanvasContext; transforms: number[][] } {
    const transforms: number[][] = []
    const noop = () => {}
    const context = {
      strokeStyle: "",
      fillStyle: "",
      lineWidth: 0,
      setTransform: (a: number, b: number, c: number, d: number, e: number, f: number) => {
        transforms.push([a, b, c, d, e, f])
      },
      clearRect: noop,
      setLineDash: noop,
      beginPath: noop,
      moveTo: noop,
      lineTo: noop,
      bezierCurveTo: noop,
      closePath: noop,
      stroke: noop,
      fill: noop,
    } satisfies EdgeCanvasContext

    return { context, transforms }
  }

  const SCENE: Scene = {
    id: "m",
    elements: [element("a"), element("b", { x: 400 })],
    edges: [{ id: "a-b", fromId: "a", toId: "b", kind: "hierarchy" }],
    background: "dots",
  }

  /** A runtime pinned to the canvas substrate, over a pane whose CSS size never changes. */
  function mountCanvas() {
    const pane = document.createElement("div")
    document.body.append(pane)
    pane.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600)
    Object.defineProperty(pane, "clientWidth", { value: 800, configurable: true })
    Object.defineProperty(pane, "clientHeight", { value: 600, configurable: true })

    const world = document.createElement("div")
    pane.append(world)

    const edgeCanvas = document.createElement("canvas")
    pane.append(edgeCanvas)
    const { context, transforms } = recorder()
    edgeCanvas.getContext = (() => context) as unknown as HTMLCanvasElement["getContext"]

    const elements: CanvasElements = { pane, world, background: null, edgeCamera: null, edgeCanvas }
    const runtime = createCanvasRuntime({
      scene: SCENE,
      elements,
      edgeMode: "canvas",
      strategy: "canvas",
    })

    return {
      runtime,
      edgeCanvas,
      transforms,
      dispose: () => {
        runtime.dispose()
        pane.remove()
      },
    }
  }

  it("sizes the backing store for the density the map opened on", () => {
    vi.stubGlobal("devicePixelRatio", 2)
    const { edgeCanvas, dispose } = mountCanvas()

    expect(edgeCanvas.width).toBe(1600)
    expect(edgeCanvas.height).toBe(1200)
    dispose()
  })

  it("picks up a density change on the next camera move, with no resize to prompt it", () => {
    // The reported failure: a monitor-to-monitor move. The pane's CSS box is fixed above and the
    // observer stubbed out for the whole suite never fires, so a camera change is the only thing
    // that happens here between the two densities.
    vi.stubGlobal("devicePixelRatio", 1)
    const { runtime, edgeCanvas, transforms, dispose } = mountCanvas()

    expect(edgeCanvas.width).toBe(800)

    vi.stubGlobal("devicePixelRatio", 2)
    transforms.length = 0
    runtime.setViewport({ x: 10, y: 0, zoom: 1 })

    expect(edgeCanvas.width).toBe(1600)
    expect(edgeCanvas.height).toBe(1200)
    // And the camera drawn under it is the new ratio's, not a surface enlarged behind a stale scale.
    expect(transforms.at(-1)?.[0]).toBe(2)
    dispose()
  })

  it("leaves the backing store alone when the density did not move", () => {
    // The guard is what makes the fresh read affordable: this runs on every frame of a pan, and an
    // unguarded resize would clear and reallocate the surface each time.
    vi.stubGlobal("devicePixelRatio", 2)
    const { runtime, edgeCanvas, dispose } = mountCanvas()

    let reallocations = 0
    Object.defineProperty(edgeCanvas, "width", {
      configurable: true,
      get: () => 1600,
      set: () => void (reallocations += 1),
    })

    runtime.setViewport({ x: 10, y: 0, zoom: 1 })
    runtime.setViewport({ x: 20, y: 0, zoom: 1.5 })

    expect(reallocations).toBe(0)
    dispose()
  })
})
