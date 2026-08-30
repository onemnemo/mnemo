// @vitest-environment jsdom

/**
 * Checks that node and frame edits flush on blur, unmount, and window shutdown.
 */

import { act } from "react"
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
  it("flushes the last typed value on an unmount that closed no other way", () => {
    const onEditEnd = vi.fn()
    act(() => root.render(<MindmapNode element={node()} editing onEditEnd={onEditEnd} />))

    const field = container.querySelector("textarea")!
    type(field, "goodbye")

    act(() => root.unmount())

    expect(onEditEnd).toHaveBeenCalledWith("a", "goodbye")
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
  it("flushes the last typed value on an unmount that closed no other way", () => {
    const onEditEnd = vi.fn()
    act(() => root.render(<MindmapNode element={frame()} editing onEditEnd={onEditEnd} />))

    const field = container.querySelector("input")!
    type(field, "Renamed")

    act(() => root.unmount())

    expect(onEditEnd).toHaveBeenCalledWith("f", "Renamed")
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
