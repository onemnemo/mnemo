// @vitest-environment jsdom

/**
 * What the find walk does with the server's answer: one request per settled query, matches in scene
 * order, the camera on the first of them, a walk that wraps, and a refresh after an edit that keeps
 * the place rather than yanking the camera back to the top.
 */

import { act, createRef, StrictMode, type RefObject } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { CanvasRuntime } from "../canvas/runtime"
import type { Scene, SceneElement, Viewport } from "../model/scene"
import { useMindmapFind, type MindmapFind } from "./useMindmapFind"

const mocks = vi.hoisted(() => ({
  findInMindmap: vi.fn(),
}))

vi.mock("./api", () => ({
  findInMindmap: mocks.findInMindmap,
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function element(id: string, x: number): SceneElement {
  return {
    id,
    kind: "node",
    content: { $type: "text", text: id },
    x,
    y: 0,
    width: 100,
    height: 40,
    depth: 0,
    branch: -1,
    nodeShape: "card",
    text: { lines: [id], fontSize: 14, fontWeight: 500, lineHeight: 19, letterSpacing: "-0.005em" },
    padding: { x: 11, y: 7 },
    isRoot: false,
    childCount: 0,
    hiddenCount: 0,
  }
}

const SCENE: Scene = {
  id: "m",
  elements: [element("a", 0), element("b", 1000), element("c", 2000)],
  edges: [],
  background: "plain",
}

function hits(...ids: string[]) {
  return { revision: 1, hits: ids.map((id) => ({ elementId: id, text: id, path: "" })) }
}

let container: HTMLElement
let root: Root
let find: MindmapFind
let cameras: Viewport[]
let revealed: string[]
let runtime: RefObject<CanvasRuntime | null>
let pane: RefObject<HTMLElement | null>

function Harness({ revision }: { revision: number }) {
  find = useMindmapFind({
    mapId: "m",
    revision,
    scene: SCENE,
    runtime,
    pane,
    onReveal: (id) => revealed.push(id),
  })
  return null
}

function render(revision = 1): void {
  act(() => {
    root.render(
      <StrictMode>
        <Harness revision={revision} />
      </StrictMode>,
    )
  })
}

/** Lets the debounce fire and the answer land. */
async function settle(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  mocks.findInMindmap.mockReset()
  cameras = []
  revealed = []
  let viewport: Viewport = { x: 0, y: 0, zoom: 1 }
  runtime = createRef<CanvasRuntime | null>()
  runtime.current = {
    viewport: () => viewport,
    setViewport: (next: Viewport) => {
      viewport = next
      cameras.push(next)
    },
    index: () =>
      ({
        boxOf: (id: string) => {
          const found = SCENE.elements.find((candidate) => candidate.id === id)
          return found ? { x: found.x, y: found.y, width: found.width, height: found.height } : undefined
        },
      }) as unknown as ReturnType<CanvasRuntime["index"]>,
  } as unknown as CanvasRuntime
  const paneElement = document.createElement("div")
  Object.defineProperty(paneElement, "clientWidth", { value: 800 })
  Object.defineProperty(paneElement, "clientHeight", { value: 600 })
  pane = createRef<HTMLElement | null>()
  pane.current = paneElement
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  render()
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})

describe("a query typed into the find bar", () => {
  it("asks once after the keystrokes settle, walks to the first match in scene order, and centres it", async () => {
    mocks.findInMindmap.mockResolvedValue(hits("c", "a"))

    act(() => find.show())
    act(() => find.setQuery("x"))
    act(() => find.setQuery("xy"))
    await settle()

    expect(mocks.findInMindmap).toHaveBeenCalledTimes(1)
    expect(mocks.findInMindmap.mock.calls[0][1]).toBe("xy")
    expect(find.count).toBe(2)
    expect(find.index).toBe(0)
    expect(revealed).toEqual(["a"])
    // Centred: the box's middle sits in the middle of the 800 by 600 pane at zoom 1.
    expect(cameras.at(-1)).toEqual({ x: 50 - 400, y: 20 - 300, zoom: 1 })
  })

  it("walks forward with wrap-around, and backward", async () => {
    mocks.findInMindmap.mockResolvedValue(hits("a", "b", "c"))
    act(() => find.show())
    act(() => find.setQuery("node"))
    await settle()

    act(() => find.next())
    act(() => find.next())
    act(() => find.next())
    expect(find.index).toBe(0)
    act(() => find.previous())
    expect(find.index).toBe(2)
    expect(revealed).toEqual(["a", "b", "c", "a", "c"])
  })

  it("leaves out a hit the scene does not draw, which is a node under a collapsed branch", async () => {
    mocks.findInMindmap.mockResolvedValue(hits("folded", "b"))
    act(() => find.show())
    act(() => find.setQuery("node"))
    await settle()

    expect(find.count).toBe(1)
    expect(revealed).toEqual(["b"])
  })

  it("asks again after an edit and keeps its place without moving the camera", async () => {
    mocks.findInMindmap.mockResolvedValue(hits("a", "b", "c"))
    act(() => find.show())
    act(() => find.setQuery("node"))
    await settle()
    act(() => find.next())
    const moved = cameras.length

    mocks.findInMindmap.mockResolvedValue(hits("b", "c"))
    render(2)
    await settle()

    expect(mocks.findInMindmap).toHaveBeenCalledTimes(2)
    expect(find.count).toBe(2)
    expect(find.index).toBe(0)
    expect(cameras.length).toBe(moved)
  })

  it("stays put on a refresh that lost the match it was on, and on one that found the first match", async () => {
    mocks.findInMindmap.mockResolvedValue(hits("a", "b", "c"))
    act(() => find.show())
    act(() => find.setQuery("node"))
    await settle()
    act(() => find.next())
    act(() => find.next())
    expect(find.index).toBe(2)
    const moved = cameras.length

    // The node on screen was renamed away: the place moves to the nearest match that is left.
    mocks.findInMindmap.mockResolvedValue(hits("a", "b"))
    render(2)
    await settle()
    expect(find.index).toBe(1)
    expect(cameras.length).toBe(moved)
    expect(revealed.at(-1)).toBe("c")

    // Nothing matched, then an edit made something match: it is counted, not shown.
    mocks.findInMindmap.mockResolvedValue(hits())
    render(3)
    await settle()
    expect(find.index).toBe(-1)
    mocks.findInMindmap.mockResolvedValue(hits("b"))
    render(4)
    await settle()
    expect(find.count).toBe(1)
    expect(find.index).toBe(0)
    expect(cameras.length).toBe(moved)
  })

  it("hands the keyboard back to the canvas when it closes", () => {
    const canvas = document.createElement("div")
    canvas.tabIndex = 0
    canvas.setAttribute("data-mm-canvas", "")
    pane.current!.appendChild(canvas)
    document.body.appendChild(pane.current!)
    const field = document.createElement("input")
    document.body.appendChild(field)
    field.focus()
    expect(document.activeElement).toBe(field)

    act(() => find.show())
    act(() => find.close())

    expect(document.activeElement).toBe(canvas)
    pane.current!.remove()
    field.remove()
  })

  it("asks nothing for an empty query, and forgets everything on close", async () => {
    mocks.findInMindmap.mockResolvedValue(hits("a"))
    act(() => find.show())
    act(() => find.setQuery("   "))
    await settle()
    expect(mocks.findInMindmap).not.toHaveBeenCalled()

    act(() => find.setQuery("a"))
    await settle()
    expect(find.count).toBe(1)

    act(() => find.close())
    expect(find.open).toBe(false)
    expect(find.query).toBe("")
    expect(find.count).toBe(0)
  })
})
