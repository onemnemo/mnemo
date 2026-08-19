// @vitest-environment jsdom

/**
 * The inline editors: a node's label and a frame's title.
 *
 * Both are uncontrolled fields tracking their own latest value in a ref, so that an unmount the
 * field never asked for still has something to flush. Before this, only a key the field itself
 * handled (Enter, Escape, a blur) ever called back; navigating away or letting the scene rebuild
 * out from under an open editor silently dropped whatever had been typed. Pinned here against the
 * real component rather than the pattern in isolation, since the thing that broke was the wiring
 * between the ref and the unmount, not the ref itself.
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

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
})
