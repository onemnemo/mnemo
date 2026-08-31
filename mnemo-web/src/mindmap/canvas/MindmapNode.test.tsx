// @vitest-environment jsdom

/**
 * Checks that node and frame edits flush on blur, unmount, and window shutdown, that opening one
 * does not close it, and that a root is drawn as the rung it resolved to.
 */

import { StrictMode, act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { resetShutdownForTests, runShutdown } from "@/app/shutdown"

import { MindmapNode } from "./MindmapNode"
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

    expect(onEditEnd).toHaveBeenCalledWith("a", "goodbye")
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

    expect(onEditEnd).toHaveBeenCalledWith("a", "hello")
  })

  it("commits what is in the field when the window closes and nothing unmounts", async () => {
    const onEditEnd = vi.fn()
    act(() => root.render(<MindmapNode element={node()} editing onEditEnd={onEditEnd} />))

    const field = container.querySelector("textarea")!
    type(field, "goodbye")

    await act(async () => {
      await runShutdown()
    })

    expect(onEditEnd).toHaveBeenCalledWith("a", "goodbye")
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

    expect(onEditEnd).toHaveBeenCalledWith("f", "Renamed")
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

    expect(onEditEnd).toHaveBeenCalledWith("f", "Renamed")
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
