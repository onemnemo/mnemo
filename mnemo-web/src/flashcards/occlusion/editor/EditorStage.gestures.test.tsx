// @vitest-environment jsdom

import { act } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { OcclusionDocument } from "../../facts/occlusion"
import { at, click, container, drag, fire, mountStage, pane, setup, teardown, translate } from "./stage-harness"
import type { OcclusionEditor } from "./useOcclusionEditor"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock("@/i18n/useT", () => ({ useT: () => translate }))

let editor: OcclusionEditor
const mount = (initial?: OcclusionDocument) => mountStage((next) => (editor = next), initial)

beforeEach(setup)
afterEach(teardown)

describe("moving", () => {
  it("drags a mask as one undo step", () => {
    mount()
    drag([at(0.15, 0.15), at(0.2, 0.17), at(0.25, 0.2)])
    expect(editor.document.masks[0].x).toBeCloseTo(0.2, 2)
    expect(editor.state.history.past).toHaveLength(1)
    act(() => editor.perform("undo"))
    expect(editor.document.masks[0].x).toBe(0.1)
  })

  it("keeps a click from moving anything", () => {
    mount()
    click(at(0.15, 0.15))
    expect(editor.state.history.past).toHaveLength(0)
  })

  it("moves the whole selection together", () => {
    mount()
    act(() => editor.store.selectAll())
    drag([at(0.15, 0.15), at(0.2, 0.15)])
    expect(editor.document.masks.map((m) => m.x)).toEqual([0.15, 0.45, 0.75].map((x) => expect.closeTo(x, 2)))
  })

  it("stops when escape cancels the drag", () => {
    mount()
    fire(pane(), "pointerdown", at(0.15, 0.15))
    fire(pane(), "pointermove", at(0.3, 0.15), { buttons: 1 })
    expect(editor.document.masks[0].x).toBeCloseTo(0.25, 2)
    act(() => editor.perform("cancel"))
    fire(pane(), "pointermove", at(0.4, 0.15), { buttons: 1 })
    fire(pane(), "pointerup", at(0.4, 0.15))
    expect(editor.document.masks[0].x).toBe(0.1)
    expect(editor.state.history.past).toHaveLength(0)
  })
})

describe("snapping", () => {
  // Mask a spans 80 to 160px, b starts at 320px. Dragging a so its right edge is 4px short of b's left edge snaps.
  it("snaps to another mask and draws a guide", () => {
    mount()
    fire(pane(), "pointerdown", at(0.15, 0.15))
    fire(pane(), "pointermove", [at(0.15, 0.15)[0] + 160 + 6, at(0.15, 0.15)[1]], { buttons: 1 })
    const guides = container().querySelectorAll('[data-testid="snap-guide"]')
    expect(guides.length).toBeGreaterThan(0)
    fire(pane(), "pointerup", at(0.4, 0.15))
    // Left edge of b is at 0.4, so a's right edge lands there: x = 0.3.
    expect(editor.document.masks[0].x).toBeCloseTo(0.3, 3)
    expect(container().querySelectorAll('[data-testid="snap-guide"]')).toHaveLength(0)
  })

  it("places freely while alt is held", () => {
    mount()
    fire(pane(), "pointerdown", at(0.15, 0.15), { altKey: true })
    fire(pane(), "pointermove", [at(0.15, 0.15)[0] + 166, at(0.15, 0.15)[1]], { buttons: 1, altKey: true })
    expect(container().querySelectorAll('[data-testid="snap-guide"]')).toHaveLength(0)
    fire(pane(), "pointerup", at(0.4, 0.15), { altKey: true })
    expect(editor.document.masks[0].x).toBeCloseTo(0.1 + 166 / 800, 3)
  })
})

describe("panning and zooming", () => {
  it("zooms about the pointer with ctrl and wheel", () => {
    mount()
    act(() => {
      pane().dispatchEvent(new WheelEvent("wheel", { ctrlKey: true, deltaY: -200, clientX: 400, clientY: 300, cancelable: true }))
    })
    expect(editor.state.view.scale).toBeGreaterThan(1)
  })

  it("pans with the pan tool", () => {
    mount()
    act(() => editor.store.zoomIn())
    act(() => editor.store.zoomIn())
    act(() => editor.store.setTool("pan"))
    const before = editor.state.view.cx
    drag([[400, 300], [300, 300]])
    expect(editor.state.view.cx).toBeGreaterThan(before)
    expect(editor.document.masks[0].x).toBe(0.1)
  })

  it("pans while space is held over the stage", () => {
    mount()
    act(() => editor.store.zoomIn())
    act(() => editor.store.zoomIn())
    act(() => {
      pane().dispatchEvent(new MouseEvent("pointerenter"))
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", key: " ", cancelable: true }))
    })
    const before = editor.state.view.cx
    drag([[400, 300], [300, 300]])
    expect(editor.state.view.cx).toBeGreaterThan(before)

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keyup", { code: "Space", key: " " }))
    })
    click(at(0.15, 0.15))
    expect(editor.selection.length).toBeLessThanOrEqual(1)
  })

  it("fits back with the fit function", () => {
    mount()
    act(() => editor.store.zoomIn())
    act(() => editor.store.fit())
    expect(editor.state.view.scale).toBe(1)
    expect(editor.zoomPercent).toBe(80)
  })
})

describe("cancelling and stray pointers", () => {
  it("escape stops a marquee and puts the old selection back", () => {
    mount()
    click(at(0.15, 0.15))
    fire(pane(), "pointerdown", at(0.02, 0.02))
    fire(pane(), "pointermove", at(0.9, 0.5), { buttons: 1 })
    expect(editor.selection.length).toBeGreaterThan(1)
    act(() => editor.perform("cancel"))
    fire(pane(), "pointermove", at(0.95, 0.6), { buttons: 1 })
    fire(pane(), "pointerup", at(0.95, 0.6))
    expect(editor.selection).toEqual(["a"])
    expect(container().querySelector('[data-testid="marquee"]')).toBeNull()
  })

  it("escape stops a pan", () => {
    mount()
    act(() => editor.store.zoomIn())
    act(() => editor.store.zoomIn())
    act(() => editor.store.setTool("pan"))
    fire(pane(), "pointerdown", [400, 300])
    fire(pane(), "pointermove", [350, 300], { buttons: 1 })
    const moved = editor.state.view.cx
    act(() => editor.perform("cancel"))
    fire(pane(), "pointermove", [200, 300], { buttons: 1 })
    expect(editor.state.view.cx).toBe(moved)
    expect(editor.state.tool).toBe("pan")
  })

  it("ignores a second pointer while one gesture is in flight", () => {
    mount()
    fire(pane(), "pointerdown", at(0.15, 0.15))
    const stray = new MouseEvent("pointermove", { bubbles: true, clientX: at(0.5, 0.15)[0], clientY: at(0.5, 0.15)[1], buttons: 1 })
    Object.defineProperty(stray, "pointerId", { value: 7 })
    act(() => {
      pane().dispatchEvent(stray)
    })
    expect(editor.state.draft).toBeNull()
    fire(pane(), "pointerup", at(0.15, 0.15))
  })

  it("keeps a focused button's space key while the pointer rests on the stage", () => {
    mount()
    const button = document.createElement("button")
    document.body.append(button)
    act(() => {
      pane().dispatchEvent(new MouseEvent("pointerenter"))
    })
    const event = new KeyboardEvent("keydown", { code: "Space", key: " ", cancelable: true, bubbles: true })
    act(() => {
      button.dispatchEvent(event)
    })
    expect(event.defaultPrevented).toBe(false)
    button.remove()
  })

  it("blocks middle-button autoscroll", () => {
    mount()
    const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 1 })
    act(() => {
      pane().dispatchEvent(event)
    })
    expect(event.defaultPrevented).toBe(true)
  })
})
