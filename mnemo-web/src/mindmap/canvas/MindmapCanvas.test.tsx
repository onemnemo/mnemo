// @vitest-environment jsdom

/**
 * The culler's grid is built from where things were, and a label being typed into grows its box
 * without reindexing. A camera move during the edit consults that stale grid, so the node under
 * the caret can be hidden while its grown box is squarely on screen. The edit holds it rendered.
 */

import { act, createRef, StrictMode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { MindmapCanvas } from "./MindmapCanvas"
import type { CanvasRuntime } from "./runtime"
import type { Scene, SceneElement } from "../model/scene"

vi.mock("@/keybinds/chord", async (original) => ({
  ...(await original<typeof import("@/keybinds/chord")>()),
  isMac: false,
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function node(id: string, over: Partial<SceneElement> = {}): SceneElement {
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

/** One node inside the first grid cell, one far enough away that culling is visibly at work. */
const SCENE: Scene = {
  id: "m",
  elements: [node("a", { x: 900 }), node("far", { x: 400_000, y: 400_000 })],
  edges: [],
  background: "plain",
}

/**
 * The camera starts at 1:1, which is the canvas substrate, and jsdom ships no 2D context. The text
 * measurer reaches for the same context, so it answers a width too.
 */
const noop = () => {}
const CONTEXT = {
  strokeStyle: "",
  fillStyle: "",
  lineWidth: 0,
  font: "",
  measureText: (text: string) => ({ width: text.length * 8 }),
  setTransform: noop,
  clearRect: noop,
  setLineDash: noop,
  beginPath: noop,
  moveTo: noop,
  lineTo: noop,
  bezierCurveTo: noop,
  closePath: noop,
  stroke: noop,
  fill: noop,
}

let container: HTMLElement
let root: Root
let runtime: ReturnType<typeof createRef<CanvasRuntime | null>>

function render(editingId: string | null): void {
  act(() => {
    root.render(
      <StrictMode>
        <MindmapCanvas scene={SCENE} runtimeRef={runtime} editingId={editingId} />
      </StrictMode>,
    )
  })
}

function host(id: string): HTMLElement {
  const found = container.querySelector<HTMLElement>(`.mm-node[data-mm-id="${id}"]`)
  if (!found) {
    throw new Error(`no host for ${id}`)
  }
  return found
}

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = (() => CONTEXT) as unknown as HTMLCanvasElement["getContext"]
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  runtime = createRef<CanvasRuntime | null>()
  render(null)

  // The pane has no size under jsdom, and the culler reads the view from it on every camera move.
  const pane = container.firstElementChild as HTMLElement
  Object.defineProperty(pane, "clientWidth", { value: 800, configurable: true })
  Object.defineProperty(pane, "clientHeight", { value: 600, configurable: true })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe("a label being typed into", () => {
  it("stays rendered when the camera moves onto its grown box", () => {
    render("a")

    // What every keystroke does: the box grows through the substrate while the grid still holds
    // the hundred pixels it opened at.
    act(() => {
      runtime.current!.index().writeBox("a", { x: 900, y: 0, width: 2300, height: 40 })
    })

    // A view over the grown box only, two cells away from the one the grid registered it in.
    act(() => {
      runtime.current!.setViewport({ x: 2100, y: 0, zoom: 1 })
    })

    expect(host("a").style.display).not.toBe("none")
    expect(host("far").style.display).toBe("none")
  })

  it("is let go of when the field closes, so the culler is back in charge", () => {
    render("a")
    act(() => {
      runtime.current!.index().writeBox("a", { x: 900, y: 0, width: 2300, height: 40 })
      runtime.current!.setViewport({ x: 2100, y: 0, zoom: 1 })
    })
    expect(host("a").style.display).not.toBe("none")

    render(null)

    // Closing writes the opening box back, which sits two cells behind the camera.
    expect(host("a").style.display).toBe("none")
  })
})

describe("double clicking an edge", () => {
  it("calls onActivateEdge, an edge having no DOM of its own to hit", () => {
    const scene: Scene = {
      id: "edge-scene",
      elements: [node("p", { x: 0, y: 0 }), node("q", { x: 300, y: 0, isRoot: false, branch: 0, depth: 1 })],
      edges: [{ id: "p-q", fromId: "p", toId: "q", kind: "hierarchy", routing: "straight" }],
      background: "plain",
    }
    const activatedEdges: string[] = []

    act(() => {
      root.render(
        <StrictMode>
          <MindmapCanvas scene={scene} runtimeRef={runtime} onActivateEdge={(id) => activatedEdges.push(id)} />
        </StrictMode>,
      )
    })

    const pane = container.firstElementChild as HTMLElement
    Object.defineProperty(pane, "clientWidth", { value: 800, configurable: true })
    Object.defineProperty(pane, "clientHeight", { value: 600, configurable: true })
    act(() => {
      runtime.current!.setViewport({ x: 0, y: 0, zoom: 1 })
    })

    // Both boxes are 40 tall at y = 0, so the straight edge runs at y = 20 between x = 100 and 300.
    act(() => {
      pane.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: 200, clientY: 20 }))
    })

    expect(activatedEdges).toEqual(["p-q"])
  })
})
