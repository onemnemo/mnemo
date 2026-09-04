// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"

import { DRAGGING_CLASS } from "@/lib/dnd/drag-select"

import {
  RESIZE_KEYBOARD_STEP,
  startEdgeResize,
  widthFromArrowKey,
  widthFromPointer,
} from "./edge-resize"

afterEach(() => {
  document.body.className = ""
  document.body.style.cursor = ""
})

describe("width from a pointer", () => {
  it("grows a right-hand panel as the pointer moves left", () => {
    expect(widthFromPointer(1000, 600, "left")).toBe(400)
    expect(widthFromPointer(1000, 500, "left")).toBe(500)
  })

  it("grows a left-hand panel as the pointer moves right", () => {
    expect(widthFromPointer(0, 400, "right")).toBe(400)
    expect(widthFromPointer(0, 520, "right")).toBe(520)
  })
})

describe("width from an arrow key", () => {
  // The key moves the edge the way it points, which is opposite arithmetic on the two sides.
  it("widens a right-hand panel on ArrowLeft and narrows it on ArrowRight", () => {
    expect(widthFromArrowKey("ArrowLeft", 500, "left")).toBe(500 + RESIZE_KEYBOARD_STEP)
    expect(widthFromArrowKey("ArrowRight", 500, "left")).toBe(500 - RESIZE_KEYBOARD_STEP)
  })

  it("narrows a left-hand panel on ArrowLeft and widens it on ArrowRight", () => {
    expect(widthFromArrowKey("ArrowLeft", 500, "right")).toBe(500 - RESIZE_KEYBOARD_STEP)
    expect(widthFromArrowKey("ArrowRight", 500, "right")).toBe(500 + RESIZE_KEYBOARD_STEP)
  })

  it("ignores every other key", () => {
    expect(widthFromArrowKey("ArrowUp", 500, "left")).toBeNull()
    expect(widthFromArrowKey("Enter", 500, "left")).toBeNull()
  })
})

describe("the drag itself", () => {
  it("reports widths, then puts the body back the way it found it", () => {
    const onWidth = vi.fn()
    startEdgeResize({ anchor: 1000, growth: "left", onWidth })

    expect(document.body.style.cursor).toBe("col-resize")
    expect(document.body.classList.contains(DRAGGING_CLASS)).toBe(true)

    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 600 }))
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 700 }))
    expect(onWidth.mock.calls).toEqual([[400], [300]])

    window.dispatchEvent(new PointerEvent("pointerup"))
    expect(document.body.style.cursor).toBe("")
    expect(document.body.classList.contains(DRAGGING_CLASS)).toBe(false)

    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 800 }))
    expect(onWidth).toHaveBeenCalledTimes(2)
  })

  // A component that unmounts under the pointer never sees the pointerup, and a body left
  // with a resize cursor and no text selection is the visible half of that leak.
  it("ends the same way when the caller stops it", () => {
    const onWidth = vi.fn()
    const stop = startEdgeResize({ anchor: 0, growth: "right", onWidth })

    stop()
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 500 }))

    expect(onWidth).not.toHaveBeenCalled()
    expect(document.body.classList.contains(DRAGGING_CLASS)).toBe(false)
  })
})
