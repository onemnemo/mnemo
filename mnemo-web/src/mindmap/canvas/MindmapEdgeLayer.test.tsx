// @vitest-environment jsdom

/**
 * Checks that edge label edits flush on blur, unmount, and window shutdown.
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { resetShutdownForTests, runShutdown } from "@/app/shutdown"

import { MindmapEdgeLabels } from "./MindmapEdgeLayer"
import type { Scene, SceneEdge, SceneElement } from "../model/scene"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function element(id: string, x: number, y: number): SceneElement {
  return {
    id,
    kind: "node",
    content: { $type: "text", text: id },
    x,
    y,
    width: 100,
    height: 40,
    depth: 1,
    branch: 0,
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
  elements: [element("a", 0, 0), element("b", 300, 0)],
  edges: [{ id: "e1", fromId: "a", toId: "b", kind: "link", label: "meets" } satisfies SceneEdge],
  background: "dots",
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

function type(field: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")!.set!
  act(() => {
    setter.call(field, value)
    field.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

function pressKey(field: HTMLInputElement, key: string, init: KeyboardEventInit = {}): void {
  act(() => {
    field.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }))
  })
}

describe("an edge label being edited", () => {
  it("flushes the last typed value on an unmount that closed no other way", () => {
    const onEditEnd = vi.fn()
    act(() => root.render(<MindmapEdgeLabels scene={SCENE} editingId="e1" onEditEnd={onEditEnd} />))

    const field = container.querySelector<HTMLInputElement>('input[data-mm-edge-label="e1"]')!
    type(field, "renamed")

    act(() => root.unmount())

    expect(onEditEnd).toHaveBeenCalledWith("e1", "renamed")
  })

  it("does not finish on a composing Enter, which belongs to the input method", () => {
    const onEditEnd = vi.fn()
    act(() => root.render(<MindmapEdgeLabels scene={SCENE} editingId="e1" onEditEnd={onEditEnd} />))

    const field = container.querySelector<HTMLInputElement>('input[data-mm-edge-label="e1"]')!
    pressKey(field, "Enter", { isComposing: true })

    expect(onEditEnd).not.toHaveBeenCalled()
  })

  it("finishes on a plain Enter, to show the guard is not just swallowing every Enter", () => {
    const onEditEnd = vi.fn()
    act(() => root.render(<MindmapEdgeLabels scene={SCENE} editingId="e1" onEditEnd={onEditEnd} />))

    const field = container.querySelector<HTMLInputElement>('input[data-mm-edge-label="e1"]')!
    pressKey(field, "Enter")

    expect(onEditEnd).toHaveBeenCalledWith("e1", "meets")
  })

  it("commits what is in the field when the window closes and nothing unmounts", async () => {
    const onEditEnd = vi.fn()
    act(() => root.render(<MindmapEdgeLabels scene={SCENE} editingId="e1" onEditEnd={onEditEnd} />))

    const field = container.querySelector<HTMLInputElement>('input[data-mm-edge-label="e1"]')!
    type(field, "renamed")

    await act(async () => {
      await runShutdown()
    })

    expect(onEditEnd).toHaveBeenCalledWith("e1", "renamed")
  })
})
