// @vitest-environment jsdom

import { act } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { OcclusionDocument } from "../../facts/occlusion"
import { groupMasks } from "./group-ops"
import { at, click, container, drag, fire, handles, mountStage, option, pane, setup, teardown, translate } from "./stage-harness"
import { makeDoc, rect, trio } from "./test-kit"
import type { OcclusionEditor } from "./useOcclusionEditor"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock("@/i18n/useT", () => ({ useT: () => translate }))

let editor: OcclusionEditor
const mount = (initial?: OcclusionDocument) => mountStage((next) => (editor = next), initial)

beforeEach(setup)
afterEach(teardown)

describe("roles and names", () => {
  it("is a multiselectable listbox of options named by number, label and group", () => {
    const grouped = groupMasks(
      makeDoc(rect("a", 0.1, 0.1, 0.1, 0.1, { label: "Rough ER" }), rect("b", 0.4, 0.2, 0.1, 0.1), rect("c", 0.7, 0.3, 0.1, 0.1, { label: "Golgi" })),
      ["a", "c"],
    ).document
    mount(grouped)

    const list = container().querySelector('[role="listbox"]')!
    expect(list.getAttribute("aria-multiselectable")).toBe("true")
    expect(list.getAttribute("aria-label")).toBe("Image masks")
    expect(list.querySelectorAll('[role="option"]')).toHaveLength(3)
    expect(option("a").getAttribute("aria-label")).toBe("Mask 1, Rough ER, group of 2")
    expect(option("c").getAttribute("aria-label")).toBe("Mask 1, Golgi, group of 2")
    expect(option("b").getAttribute("aria-label")).toBe("Mask 2")
  })

  it("names a labelled single mask", () => {
    mount(makeDoc(rect("a", 0.1, 0.1, 0.1, 0.1), rect("b", 0.4, 0.2, 0.1, 0.1), rect("c", 0.7, 0.3, 0.1, 0.1), rect("d", 0.1, 0.6, 0.1, 0.1, { label: "Rough ER" })))
    expect(option("d").getAttribute("aria-label")).toBe("Mask 4, Rough ER")
  })

  it("keeps one tab stop that follows the selection", () => {
    mount()
    const stops = () => [...container().querySelectorAll('[role="option"]')].filter((el) => el.getAttribute("tabindex") === "0")
    expect(stops().map((el) => el.getAttribute("data-mask"))).toEqual(["a"])
    click(at(0.45, 0.25))
    expect(stops().map((el) => el.getAttribute("data-mask"))).toEqual(["b"])
  })

  it("marks the selected options", () => {
    mount()
    click(at(0.15, 0.15))
    expect(option("a").getAttribute("aria-selected")).toBe("true")
    expect(option("b").getAttribute("aria-selected")).toBe("false")
  })

  it("selects on Enter or Space and not merely on focus", () => {
    mount()
    act(() => option("c").focus())
    expect(editor.selection).toEqual([])
    act(() => {
      option("c").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    })
    expect(editor.selection).toEqual(["c"])
    act(() => {
      option("a").dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }))
    })
    expect(editor.selection).toEqual(["a"])
  })

  it("takes focus on a click so keys reach the editor", () => {
    mount()
    click(at(0.95, 0.95))
    expect(document.activeElement).toBe(pane())
  })
})

describe("selection", () => {
  it("selects the whole group from any member", () => {
    mount(groupMasks(trio(), ["a", "c"]).document)
    click(at(0.75, 0.35))
    expect(editor.selection.sort()).toEqual(["a", "c"])
  })

  it("adds with shift and clears on an empty click", () => {
    mount()
    click(at(0.15, 0.15))
    click(at(0.45, 0.25), { shiftKey: true })
    expect(editor.selection.sort()).toEqual(["a", "b"])
    click(at(0.95, 0.95))
    expect(editor.selection).toEqual([])
  })

  it("narrows several selected masks to the one clicked", () => {
    mount()
    act(() => editor.store.selectAll())
    click(at(0.45, 0.25))
    expect(editor.selection).toEqual(["b"])
  })

  it("selects by marquee, adding with shift", () => {
    mount()
    drag([at(0.02, 0.02), at(0.55, 0.28)])
    expect(editor.selection.sort()).toEqual(["a", "b"])
    expect(container().querySelector('[data-testid="marquee"]')).toBeNull()

    drag([at(0.65, 0.25), at(0.9, 0.5)], { shiftKey: true })
    expect(editor.selection.sort()).toEqual(["a", "b", "c"])
  })

  it("shows the marquee while dragging", () => {
    mount()
    fire(pane(), "pointerdown", at(0.02, 0.02))
    fire(pane(), "pointermove", at(0.3, 0.3), { buttons: 1 })
    expect(container().querySelector('[data-testid="marquee"]')).not.toBeNull()
    fire(pane(), "pointerup", at(0.3, 0.3))
  })
})

describe("handles", () => {
  it("shows eight on one selected mask and none on several", () => {
    mount()
    click(at(0.15, 0.15))
    expect(handles()).toHaveLength(8)
    act(() => editor.store.selectAll())
    expect(handles()).toHaveLength(0)
  })

  it("drops the top and bottom mid handles under 24px tall", () => {
    mount(makeDoc(rect("short", 0.1, 0.1, 0.2, 0.05), rect("tall", 0.5, 0.1, 0.2, 0.1)))
    click(at(0.2, 0.12))
    expect([...handles()].map((h) => h.getAttribute("data-handle")).sort()).toEqual(["e", "ne", "nw", "se", "sw", "w"])
    click(at(0.6, 0.15))
    expect(handles()).toHaveLength(8)
  })

  it("resizes by dragging a handle", () => {
    mount()
    click(at(0.15, 0.15))
    const east = container().querySelector<HTMLElement>('[data-handle="e"]')!
    drag([at(0.2, 0.15), at(0.3, 0.15)], {}, east)
    expect(editor.document.masks[0].w).toBeCloseTo(0.2, 3)
    expect(editor.document.masks[0].x).toBe(0.1)
  })

  it("moves a polygon vertex", () => {
    mount()
    act(() => {
      editor.store.setTool("polygon")
      for (const p of [[0.2, 0.6], [0.4, 0.6], [0.3, 0.9]] as [number, number][]) editor.store.addPoint(p)
      editor.store.finishPolygon()
      editor.store.setTool("select")
    })
    const id = editor.document.masks.at(-1)!.id
    const vertex = container().querySelector<HTMLElement>('[data-vertex="2"]')!
    expect(container().querySelectorAll("[data-vertex]")).toHaveLength(3)
    drag([at(0.3, 0.9), at(0.3, 0.7)], {}, vertex)
    expect(editor.document.masks.find((m) => m.id === id)!.points![2][1]).toBeCloseTo(0.7, 2)
  })
})

describe("hover", () => {
  it("rings the hovered mask lightly and a selected one fully", () => {
    mount()
    fire(pane(), "pointermove", at(0.15, 0.15))
    expect(option("a").style.boxShadow).toContain("42%")
    click(at(0.15, 0.15))
    expect(option("a").style.boxShadow).not.toContain("42%")
    expect(option("a").style.boxShadow).toContain("1.25px")
  })

  it("rings what the cards list hovers", () => {
    mount()
    act(() => editor.store.setHovered("c"))
    expect(option("c").style.boxShadow).toContain("42%")
  })
})
