// @vitest-environment jsdom

import { act } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { OcclusionDocument } from "../../facts/occlusion"
import { groupMasks } from "./group-ops"
import { at, badges, click, container, drag, fire, mountStage, option, pane, setup, teardown, translate } from "./stage-harness"
import { makeDoc, rect } from "./test-kit"
import type { OcclusionEditor } from "./useOcclusionEditor"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock("@/i18n/useT", () => ({ useT: () => translate }))

let editor: OcclusionEditor
const mount = (initial?: OcclusionDocument) => mountStage((next) => (editor = next), initial)

beforeEach(setup)
afterEach(teardown)

describe("drawing", () => {
  it("draws a rectangle by dragging and stays armed", () => {
    mount()
    act(() => editor.store.setTool("rect"))
    drag([at(0.5, 0.5), at(0.6, 0.6), at(0.75, 0.75)])
    const added = editor.document.masks.at(-1)!
    expect(added).toMatchObject({ shape: "rect", x: 0.5, y: 0.5 })
    expect(added.w).toBeCloseTo(0.25, 3)
    expect(editor.selection).toEqual([added.id])
    expect(editor.state.tool).toBe("rect")

    drag([at(0.1, 0.6), at(0.2, 0.8)])
    expect(editor.document.masks).toHaveLength(5)
  })

  it("draws an ellipse", () => {
    mount()
    act(() => editor.store.setTool("ellipse"))
    drag([at(0.5, 0.5), at(0.7, 0.8)])
    expect(editor.document.masks.at(-1)).toMatchObject({ shape: "ellipse" })
  })

  it("makes nothing from a click or a sliver", () => {
    mount()
    act(() => editor.store.setTool("rect"))
    click(at(0.5, 0.5))
    drag([at(0.5, 0.5), at(0.5, 0.8)])
    expect(editor.document.masks).toHaveLength(3)
  })

  it("draws within the image when the drag leaves it", () => {
    mount()
    act(() => editor.store.setTool("rect"))
    drag([at(0.8, 0.8), [1200, 900]])
    const added = editor.document.masks.at(-1)!
    expect(added.x + added.w).toBeLessThanOrEqual(1)
    expect(added.y + added.h).toBeLessThanOrEqual(1)
  })

  it("abandons a drawing when escape cancels it", () => {
    mount()
    act(() => editor.store.setTool("rect"))
    fire(pane(), "pointerdown", at(0.5, 0.5))
    fire(pane(), "pointermove", at(0.7, 0.7), { buttons: 1 })
    act(() => editor.perform("cancel"))
    fire(pane(), "pointermove", at(0.8, 0.8), { buttons: 1 })
    fire(pane(), "pointerup", at(0.8, 0.8))
    expect(editor.document.masks).toHaveLength(3)
  })

  it("draws a polygon by clicks and finishes on a double click", () => {
    mount()
    act(() => editor.store.setTool("polygon"))
    click(at(0.1, 0.6))
    click(at(0.3, 0.6))
    click(at(0.2, 0.9))
    expect(container().querySelectorAll('[data-testid="pending-point"]')).toHaveLength(3)

    act(() => {
      pane().dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: at(0.2, 0.9)[0], clientY: at(0.2, 0.9)[1] }))
    })
    expect(container().querySelectorAll('[data-testid="pending-point"]')).toHaveLength(0)
    expect(editor.document.masks.at(-1)).toMatchObject({ shape: "polygon" })
    expect(editor.document.masks.at(-1)!.points).toHaveLength(3)
    expect(editor.state.tool).toBe("polygon")
  })

  it("counts a double click as one point", () => {
    mount()
    act(() => editor.store.setTool("polygon"))
    click(at(0.1, 0.6))
    click(at(0.1, 0.6))
    expect(editor.state.pending).toHaveLength(1)
  })

  it("finishes with Enter, removes a point with Backspace and cancels with Escape", () => {
    mount()
    act(() => editor.store.setTool("polygon"))
    for (const p of [[0.1, 0.6], [0.3, 0.6], [0.2, 0.9], [0.5, 0.9]] as [number, number][]) click(at(...p))
    act(() => editor.perform("delete"))
    expect(editor.state.pending).toHaveLength(3)
    act(() => editor.perform("finish-polygon"))
    expect(editor.document.masks).toHaveLength(4)

    click(at(0.6, 0.6))
    click(at(0.8, 0.6))
    act(() => editor.perform("cancel"))
    expect(editor.state.pending).toBeNull()
    expect(editor.document.masks).toHaveLength(4)
  })

  it("will not finish a polygon with two points", () => {
    mount()
    act(() => editor.store.setTool("polygon"))
    click(at(0.1, 0.6))
    click(at(0.3, 0.6))
    act(() => {
      pane().dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))
    })
    expect(editor.document.masks).toHaveLength(3)
  })
})

describe("grouping through the controller", () => {
  it("groups, ungroups, undoes and redoes", () => {
    mount()
    drag([at(0.02, 0.02), at(0.95, 0.5)])
    expect(editor.selection).toHaveLength(3)

    act(() => editor.perform("group"))
    expect(editor.cards).toHaveLength(1)
    expect(editor.selectionIsGroup).toBe(true)
    expect(badges()).toHaveLength(3)
    expect(option("c").querySelector("svg")).not.toBeNull()

    act(() => editor.perform("ungroup"))
    expect(editor.cards).toHaveLength(3)
    expect(editor.selectionIsGroup).toBe(false)

    act(() => editor.perform("undo"))
    expect(editor.cards).toHaveLength(1)
    act(() => editor.perform("redo"))
    expect(editor.cards).toHaveLength(3)
  })
})

describe("badges", () => {
  const many = (count: number) =>
    makeDoc(...Array.from({ length: count }, (_, i) => rect(`m${i}`, (i % 10) * 0.09, Math.floor(i / 10) * 0.2, 0.08, 0.1)))

  it("shows every badge up to fifteen masks", () => {
    mount(many(15))
    expect(badges()).toHaveLength(15)
  })

  it("shows only selected and hovered ones above fifteen", () => {
    mount(many(16))
    expect(badges()).toHaveLength(0)

    click(at(0.04, 0.05))
    expect(badges()).toHaveLength(1)

    fire(pane(), "pointermove", at(0.13, 0.05))
    expect(badges()).toHaveLength(2)
  })

  it("shows grouped ones above fifteen", () => {
    const grouped = groupMasks(many(16), ["m0", "m1"]).document
    mount(grouped)
    expect(badges()).toHaveLength(2)
  })

  it("shows all of them at twice fit or more", () => {
    mount(many(16))
    act(() => editor.store.setView({ scale: 2, cx: 0.5, cy: 0.5 }))
    expect(badges().length).toBeGreaterThan(0)
    expect(badges().length).toBeLessThanOrEqual(16)
  })

  it("hides the badge on a mask under 20px tall", () => {
    mount(makeDoc(rect("a", 0.1, 0.1, 0.2, 0.04), rect("b", 0.5, 0.1, 0.2, 0.1)))
    expect([...badges()].map((b) => b.closest("[data-mask]")?.getAttribute("data-mask"))).toEqual(["b"])
  })

  it("numbers badges from card order", () => {
    mount()
    expect([...badges()].map((b) => b.textContent)).toEqual(["1", "2", "3"])
  })
})
