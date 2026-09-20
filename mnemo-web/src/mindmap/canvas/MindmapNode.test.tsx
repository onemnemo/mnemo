// @vitest-environment jsdom

/**
 * Checks that node and frame edits flush on blur, unmount, and window shutdown, that opening one
 * does not close it, and that a root is drawn as the rung it resolved to.
 *
 * A node label here is the textarea that stands in until the editor chunk arrives, which is what a
 * synchronous render sees; the editor itself is NodeEditor.test.tsx's.
 */

import { StrictMode, act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { resetShutdownForTests, runShutdown } from "@/app/shutdown"

import { measureFor } from "./live-box"
import { MindmapNode } from "./MindmapNode"
import { plainRuns } from "../model/runs"
import type { SceneElement } from "../model/scene"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function node(over: Partial<SceneElement> = {}): SceneElement {
  return {
    id: "a",
    kind: "node",
    content: { $type: "text", text: "hello" },
    x: 0,
    y: 0,
    width: 120,
    height: 40,
    depth: 1,
    branch: 0,
    nodeShape: "card",
    text: { lines: ["hello"], fontSize: 14, fontWeight: 500, lineHeight: 19, letterSpacing: "-0.005em" },
    padding: { x: 11, y: 7 },
    isRoot: false,
    childCount: 0,
    hiddenCount: 0,
    ...over,
  }
}

function frame(over: Partial<SceneElement> = {}): SceneElement {
  return node({
    id: "f",
    kind: "frame",
    content: { $type: "frame", title: "Untitled" },
    width: 300,
    height: 200,
    depth: -1,
    branch: -1,
    ...over,
  })
}

function line(over: Partial<SceneElement> = {}): SceneElement {
  return node({
    kind: "shape",
    content: { $type: "shape", shape: "line", text: "hello" },
    width: 116,
    height: 16,
    text: {
      lines: ["hello"],
      fontSize: 14,
      fontWeight: 500,
      lineHeight: 19,
      letterSpacing: "-0.005em",
      width: 40,
      height: 19,
    },
    line: {
      start: { x: 8, y: 8 },
      end: { x: 108, y: 8 },
      bend: null,
      startAt: null,
      endAt: null,
      startCap: "none",
      endCap: "none",
      thickness: 1.5,
      extent: { minX: -2, minY: -2, maxX: 118, maxY: 18 },
    },
    ...over,
  })
}

let container: HTMLElement
let root: Root

beforeEach(() => {
  resetShutdownForTests()
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function type(field: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(field),
    "value",
  )!.set!
  act(() => {
    setter.call(field, value)
    field.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

function pressKey(
  field: HTMLInputElement | HTMLTextAreaElement,
  key: string,
  init: KeyboardEventInit = {},
): void {
  act(() => {
    field.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }))
  })
}

describe("a node label being edited", () => {
  it("flushes the last typed value on an unmount that closed no other way", async () => {
    const onEditEnd = vi.fn()
    act(() => root.render(<MindmapNode element={node()} editing onEditEnd={onEditEnd} />))

    const field = container.querySelector("textarea")!
    type(field, "goodbye")

    await act(async () => root.unmount())

    expect(onEditEnd).toHaveBeenCalledWith("a", { runs: plainRuns("goodbye") })
  })

  it("stays open when React tears the mount effect down and sets it back up", async () => {
    // StrictMode does this in development to prove an effect's teardown is something its setup
    // undoes. The flush is not, so running it there closes the field in the frame it opens.
    const onEditEnd = vi.fn()
    act(() =>
      root.render(
        <StrictMode>
          <MindmapNode element={node()} editing onEditEnd={onEditEnd} />
        </StrictMode>,
      ),
    )
    // Past the tick the teardown's flush was queued on, or this passes against a flush that was
    // only deferred and never called off.
    await act(async () => {})

    expect(onEditEnd).not.toHaveBeenCalled()
    expect(container.querySelector("textarea")).not.toBeNull()
  })

  it("does not finish on a composing Enter, which belongs to the input method", () => {
    const onEditEnd = vi.fn()
    act(() => root.render(<MindmapNode element={node()} editing onEditEnd={onEditEnd} />))

    const field = container.querySelector("textarea")!
    pressKey(field, "Enter", { isComposing: true })

    expect(onEditEnd).not.toHaveBeenCalled()
  })

  it("finishes on a plain Enter, to show the guard is not just swallowing every Enter", () => {
    const onEditEnd = vi.fn()
    act(() => root.render(<MindmapNode element={node()} editing onEditEnd={onEditEnd} />))

    const field = container.querySelector("textarea")!
    pressKey(field, "Enter")

    expect(onEditEnd).toHaveBeenCalledWith("a", { runs: plainRuns("hello") })
  })

  it("commits what is in the field when the window closes and nothing unmounts", async () => {
    const onEditEnd = vi.fn()
    act(() => root.render(<MindmapNode element={node()} editing onEditEnd={onEditEnd} />))

    const field = container.querySelector("textarea")!
    type(field, "goodbye")

    await act(async () => {
      await runShutdown()
    })

    expect(onEditEnd).toHaveBeenCalledWith("a", { runs: plainRuns("goodbye") })
  })

  it("waits for the write before letting the exit go through", async () => {
    let land!: () => void
    const held = new Promise<void>((resolve) => {
      land = resolve
    })
    const onEditEnd = vi.fn(() => held)
    act(() => root.render(<MindmapNode element={node()} editing onEditEnd={onEditEnd} />))

    const field = container.querySelector("textarea")!
    type(field, "goodbye")

    let drained = false
    const draining = runShutdown().then(() => {
      drained = true
    })
    // Wait a macrotask so the assertion does not depend on how far act drains the handshake
    // promise chain.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(onEditEnd).toHaveBeenCalled()
    // The handshake must wait for the write before allowing the host to close.
    expect(drained).toBe(false)

    land()
    await act(async () => {
      await draining
    })
    expect(drained).toBe(true)
  })
})

describe("a frame title being edited", () => {
  it("flushes the last typed value on an unmount that closed no other way", async () => {
    const onEditEnd = vi.fn()
    act(() => root.render(<MindmapNode element={frame()} editing onEditEnd={onEditEnd} />))

    const field = container.querySelector("input")!
    type(field, "Renamed")

    await act(async () => root.unmount())

    expect(onEditEnd).toHaveBeenCalledWith("f", { text: "Renamed" })
  })

  it("stays open when React tears the mount effect down and sets it back up", async () => {
    const onEditEnd = vi.fn()
    act(() =>
      root.render(
        <StrictMode>
          <MindmapNode element={frame()} editing onEditEnd={onEditEnd} />
        </StrictMode>,
      ),
    )
    await act(async () => {})

    expect(onEditEnd).not.toHaveBeenCalled()
    expect(container.querySelector("input")).not.toBeNull()
  })

  it("does not finish on a composing Enter, which belongs to the input method", () => {
    const onEditEnd = vi.fn()
    act(() => root.render(<MindmapNode element={frame()} editing onEditEnd={onEditEnd} />))

    const field = container.querySelector("input")!
    pressKey(field, "Enter", { isComposing: true })

    expect(onEditEnd).not.toHaveBeenCalled()
  })

  it("commits what is in the field when the window closes and nothing unmounts", async () => {
    const onEditEnd = vi.fn()
    act(() => root.render(<MindmapNode element={frame()} editing onEditEnd={onEditEnd} />))

    const field = container.querySelector("input")!
    type(field, "Renamed")

    await act(async () => {
      await runShutdown()
    })

    expect(onEditEnd).toHaveBeenCalledWith("f", { text: "Renamed" })
  })
})

describe("line handles", () => {
  it("reconciles a handle that a live drag moved outside React", () => {
    const before = line()
    act(() => root.render(<MindmapNode element={before} />))

    const start = container.querySelector<SVGGElement>('[data-mm-handle="start"]')!
    start.setAttribute("transform", "translate(22 -140)")

    act(() =>
      root.render(
        <MindmapNode
          element={line({
            x: 80,
            y: 221,
            width: 321,
            height: 169,
            line: {
              ...before.line!,
              start: { x: 8, y: 8 },
              end: { x: 313, y: 161 },
              bend: { x: 161, y: 84 },
            },
          })}
        />,
      ),
    )

    expect(container.querySelector('[data-mm-handle="start"]')).toBe(start)
    expect(start.getAttribute("transform")).toBe("translate(8 8)")
  })
})

describe("a line label", () => {
  it("sits at the bend handle while the handle remains above the caption", () => {
    act(() => root.render(<MindmapNode element={line()} />))

    const label = container.querySelector<HTMLElement>("[data-mm-line-label]")!
    const bend = container.querySelector<SVGGElement>('[data-mm-handle="bend"]')!
    expect(label.style.transform).toBe("translate(58px, 8px) translate(-50%, -50%)")
    expect(bend.getAttribute("transform")).toBe("translate(58 8)")
    expect(label.nextElementSibling?.contains(bend)).toBe(true)
    expect(label.style.boxShadow).toBe("0 0 0 1px var(--line-soft)")
    expect(label.className).toContain("bg-canvas")
  })

  it("hides the line handles while the caption is being edited", () => {
    const element = line()
    const onEditEnd = vi.fn()
    act(() => root.render(<MindmapNode element={element} />))
    const handles = container.querySelector<SVGGElement>("[data-mm-line-handles]")!

    act(() => root.render(<MindmapNode element={element} editing onEditEnd={onEditEnd} />))

    const label = container.querySelector<HTMLElement>("[data-mm-line-label]")!
    expect(handles.closest("svg")!.style.display).toBe("none")
    expect(label.style.boxShadow).toBe("0 0 0 2px var(--accent)")
    expect(label.className).toContain("bg-canvas")
    expect(label.className).toContain("min-w-[56px]")

    act(() => root.render(<MindmapNode element={element} />))
    expect(container.querySelector("[data-mm-line-handles]")).toBe(handles)
    expect(handles.closest("svg")!.style.display).toBe("")
  })
})

describe("the box under a label being typed into", () => {
  const hostBox = (): HTMLElement => container.querySelector<HTMLElement>(".mm-node")!

  /** A node whose box is exactly what its own label measures to, which is how the projector makes one. */
  const autoNode = (text: string) => {
    const seed = node({ content: { $type: "text", text }, text: { lines: [text], fontSize: 14, fontWeight: 500, lineHeight: 19, letterSpacing: "-0.005em" } })
    const measured = measureFor(seed, { text })
    return node({ ...seed, width: measured.width, height: measured.height })
  }

  it("grows with the text, rather than letting it run out through the sides", () => {
    const element = autoNode("hi")
    act(() => root.render(<MindmapNode element={element} editing onEditEnd={vi.fn()} />))
    const before = hostBox().style.width

    const field = container.querySelector("textarea")!
    type(field, "a much longer label than the one it opened on")

    expect(hostBox().style.width).toBe(`${measureFor(element, { text: "a much longer label than the one it opened on" }).width}px`)
    expect(parseFloat(hostBox().style.width)).toBeGreaterThan(parseFloat(before))
  })

  it("takes the field's height only once the new width has landed", () => {
    const element = autoNode("hi")
    act(() => root.render(<MindmapNode element={element} editing onEditEnd={vi.fn()} />))
    const field = container.querySelector("textarea")!
    const box = hostBox()
    const opened = box.style.width

    // A field that answers for the width it has right now, which is what a real one does. Asked
    // before the new width is written it reports the line count of the box a keystroke ago, and the
    // box and the text it holds spent every keystroke disagreeing by a line.
    Object.defineProperty(field, "scrollHeight", {
      configurable: true,
      get: () => (box.style.width === opened ? 38 : 19),
    })

    type(field, "a label long enough that the box has to widen for it")

    expect(box.style.height).toBe(`${19 + element.padding.y * 2}px`)
  })

  it("tells the substrate its new box, so the branches meeting it can follow", () => {
    const element = autoNode("hi")
    const onEditResize = vi.fn()
    act(() =>
      root.render(<MindmapNode element={element} editing onEditEnd={vi.fn()} onEditResize={onEditResize} />),
    )
    onEditResize.mockClear()

    const grown = "a label long enough that the box has to widen for it"
    type(container.querySelector("textarea")!, grown)

    expect(onEditResize).toHaveBeenCalledWith("a", {
      x: element.x,
      y: element.y,
      width: measureFor(element, { text: grown }).width,
      height: parseFloat(hostBox().style.height),
    })
  })

  it("tells it again when the edit is abandoned, so they follow the box back", () => {
    const element = autoNode("hi")
    const onEditResize = vi.fn()
    act(() =>
      root.render(<MindmapNode element={element} editing onEditEnd={vi.fn()} onEditResize={onEditResize} />),
    )
    type(container.querySelector("textarea")!, "a label long enough that the box has to widen for it")
    onEditResize.mockClear()

    act(() => root.render(<MindmapNode element={element} onEditEnd={vi.fn()} onEditResize={onEditResize} />))

    expect(onEditResize).toHaveBeenCalledWith("a", {
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
    })
  })

  it("puts the box back when the edit is abandoned, which changed no text at all", () => {
    const element = autoNode("hi")
    act(() => root.render(<MindmapNode element={element} editing onEditEnd={vi.fn()} />))
    const before = hostBox().style.width

    type(container.querySelector("textarea")!, "a much longer label")
    // Escape leaves the document alone, so this node re-renders on the size it always had.
    act(() => root.render(<MindmapNode element={element} onEditEnd={vi.fn()} />))

    expect(hostBox().style.width).toBe(before)
  })

  it("leaves a box that was given a size by hand, which the projector would keep anyway", () => {
    const element = node({ width: 400, height: 200 })
    act(() => root.render(<MindmapNode element={element} editing onEditEnd={vi.fn()} />))

    type(container.querySelector("textarea")!, "a much longer label than the one it opened on")

    expect(hostBox().style.width).toBe("400px")
    expect(hostBox().style.height).toBe("200px")
  })
})

describe("a root's box", () => {
  /** The body, which is the one child of the host that carries the rung's own look. */
  const bodyOfNode = (): HTMLElement => container.querySelector<HTMLElement>(".mm-node > div.relative")!

  it("is the lifted card on the rung it resolves to by default", () => {
    act(() => root.render(<MindmapNode element={node({ isRoot: true, nodeShape: "card" })} />))

    const body = bodyOfNode()
    expect(body.className).toContain("rounded-[14px]")
    expect(body.getAttribute("style")).toContain("12px")
  })

  it("shows the colour it was given, which on the card rung is a ring around the lift", () => {
    act(() =>
      root.render(<MindmapNode element={node({ isRoot: true, nodeShape: "card", stroke: "var(--branch-3)" })} />),
    )

    expect(bodyOfNode().getAttribute("style")).toContain("var(--branch-3)")
  })

  it("takes another rung when one was chosen, rather than staying a card", () => {
    act(() => root.render(<MindmapNode element={node({ isRoot: true, nodeShape: "pill" })} />))

    const body = bodyOfNode()
    expect(body.className).toContain("rounded-full")
    expect(body.className).not.toContain("rounded-[14px]")
  })

  it("draws a rule and no box at all on the plain rung", () => {
    act(() => root.render(<MindmapNode element={node({ isRoot: true, nodeShape: "plain", underline: 7 })} />))

    const body = bodyOfNode()
    expect(body.getAttribute("style")).toContain("border-bottom: 7px solid")
    expect(body.className).not.toContain("rounded")
  })
})
