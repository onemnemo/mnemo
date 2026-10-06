// @vitest-environment jsdom

import { act } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { loadImages } from "../../image-test-helpers"
import { makeDoc, rect } from "../test-kit"
import {
  button,
  byLabel,
  clearViewport,
  click,
  draftWith,
  masksOf,
  mountLayout,
  rows,
  seedKeybinds,
  setViewport,
  text,
  unmountLayout,
  useEnglish,
} from "./chrome-harness"

vi.mock("../../../editor/assets", () => ({
  uploadCardAsset: vi.fn(),
  useCardAssetUrl: (id: string | null | undefined) => (id ? "blob:test" : null),
  useCardAsset: (id: string | null | undefined) => ({ url: (id ? "blob:test" : null), failed: false }),
}))

beforeEach(() => {
  useEnglish()
  seedKeybinds()
  setViewport(1280, 800)
})

afterEach(() => {
  unmountLayout()
  clearViewport()
})

const three = () =>
  makeDoc(rect("a", 0.1, 0.1, 0.2, 0.2), rect("b", 0.4, 0.1, 0.2, 0.2), rect("c", 0.7, 0.1, 0.2, 0.2))
const bar = () => document.querySelector<HTMLElement>('[data-testid="occlusion-selection-bar"]')
const barButtons = () => [...(bar()?.querySelectorAll("button") ?? [])]
const frame = () => {
  const style = document.querySelector<HTMLElement>('[data-testid="editor-frame"]')!.style
  return { x: parseFloat(style.left), y: parseFloat(style.top), w: parseFloat(style.width), h: parseFloat(style.height) }
}

function selectCards(...indexes: number[]): void {
  click(rows()[indexes[0]])
  for (const index of indexes.slice(1)) click(rows()[index], { ctrlKey: true })
}

describe("selection bar", () => {
  it("stays away from one card", () => {
    mountLayout({ draft: draftWith(three()) })
    selectCards(0)
    expect(bar()).toBeNull()
  })

  it("holds Group, six align slots and two distribute slots, and no count or Delete", () => {
    mountLayout({ draft: draftWith(three()) })
    selectCards(0, 1)

    const names = barButtons().map((slot) => slot.getAttribute("aria-label"))
    expect(names).toEqual([
      "Group",
      "Align left",
      "Align centers horizontally",
      "Align right",
      "Align top",
      "Align middles vertically",
      "Align bottom",
      "Distribute horizontally",
      "Distribute vertically",
    ])
    expect(bar()!.textContent).not.toMatch(/\d|Delete/)
  })

  it("dims the two distribute slots below three cards and wakes them at three", () => {
    mountLayout({ draft: draftWith(three()) })
    selectCards(0, 1)
    expect(barButtons().slice(-2).every((slot) => slot.disabled)).toBe(true)

    selectCards(0, 1, 2)
    expect(barButtons().slice(-2).every((slot) => !slot.disabled)).toBe(true)
  })

  it("hangs above the top centre of the selection", () => {
    mountLayout({ draft: draftWith(three()) })
    selectCards(0, 1)

    const { x, y, w, h } = frame()
    const wrapper = bar()!
    // Masks a and b span 0.1 to 0.6 across; the top edge is at 0.1 down.
    expect(parseFloat(wrapper.style.left)).toBeCloseTo(Math.max(8, x + 0.35 * w), 0)
    expect(parseFloat(wrapper.style.top)).toBeCloseTo(Math.max(8, y + 0.1 * h - 14), 0)
  })

  it("groups, then reads Ungroup as pressed, then ungroups", () => {
    const spies = mountLayout({ draft: draftWith(three()) })
    selectCards(0, 1)
    click(button("Group")!)

    expect(masksOf(spies).filter((mask) => mask.group)).toHaveLength(2)
    const toggle = button("Ungroup")!
    expect(toggle.getAttribute("aria-pressed")).toBe("true")
    expect(bar()).not.toBeNull()

    click(toggle)
    expect(masksOf(spies).filter((mask) => mask.group)).toHaveLength(0)
    expect(button("Ungroup")).toBeUndefined()
  })

  it("shows for a lone group", () => {
    const grouped = makeDoc(rect("a", 0.1, 0.1, 0.2, 0.2, { group: "a" }), rect("b", 0.4, 0.1, 0.2, 0.2, { group: "a" }), rect("c", 0.7, 0.1, 0.2, 0.2))
    mountLayout({ draft: draftWith(grouped) })
    selectCards(0)

    expect(button("Ungroup")).toBeDefined()
  })

  it("aligns the selected cards", () => {
    const uneven = makeDoc(rect("a", 0.1, 0.1, 0.2, 0.2), rect("b", 0.4, 0.4, 0.2, 0.2))
    const spies = mountLayout({ draft: draftWith(uneven) })
    selectCards(0, 1)
    click(button("Align top")!)

    const value = JSON.parse(spies.draft().values.masks) as { masks: { id: string; y: number }[] }
    expect(value.masks.map((mask) => mask.y)).toEqual([0.1, 0.1])
  })

  it("fades out over the conceal time and unmounts when the fade ends", () => {
    mountLayout({ draft: draftWith(three()) })
    selectCards(0, 1)
    const real = window.getComputedStyle
    const spy = vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudo) => {
      const style = real(element, pseudo)
      return new Proxy(style, { get: (target, name) => (name === "transitionDuration" ? "0.22s" : Reflect.get(target, name)) })
    })

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }))
    })
    expect(bar()).not.toBeNull()
    expect(bar()!.style.opacity).toBe("0")
    expect(bar()!.style.transition).toContain("--duration-conceal")

    act(() => {
      const end = new Event("transitionend", { bubbles: true })
      Object.defineProperty(end, "propertyName", { value: "opacity" })
      bar()!.dispatchEvent(end)
    })
    expect(bar()).toBeNull()
    spy.mockRestore()
  })

  it("unmounts at once when there is no transition", () => {
    mountLayout({ draft: draftWith(three()) })
    selectCards(0, 1)
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }))
    })
    expect(bar()).toBeNull()
  })
})

describe("tool bar", () => {
  const slots = () => [...document.querySelectorAll<HTMLElement>("[data-tb-tool]")]

  it("holds Select, Pan, then Rectangle, Ellipse and Polygon, with their keys", () => {
    mountLayout()

    expect(slots().map((slot) => slot.getAttribute("aria-label"))).toEqual([
      "Select",
      "Pan",
      "Add rectangle",
      "Add ellipse",
      "Add polygon",
    ])
    expect(slots().map((slot) => slot.getAttribute("data-tooltip-chord"))).toEqual(["V", "H", "R", "E", "P"])
  })

  it("arms a tool on a press and slides the chip under it", () => {
    mountLayout()
    const chip = () => document.querySelector<HTMLElement>('[role="toolbar"] > span[aria-hidden]')!
    const before = chip().style.left

    click(slots()[3])
    expect(slots()[3].getAttribute("aria-pressed")).toBe("true")
    expect(slots()[0].getAttribute("aria-pressed")).toBe("false")
    expect(chip().style.left).not.toBe(before)
    expect(chip().style.transition).toContain("--duration-chip")
  })

  it("docks at the bottom centre in a wide window", () => {
    mountLayout()
    const dock = document.querySelector<HTMLElement>('[role="toolbar"]')!.parentElement!
    expect(dock.style.left).toBe("50%")
  })
})

describe("view dock", () => {
  const readout = () => byLabel("Zoom")

  it("zooms in and out, and the readout follows", () => {
    mountLayout()
    const start = text(readout())

    click(byLabel("Zoom in"))
    click(byLabel("Zoom in"))
    const zoomedIn = parseInt(text(readout()))
    expect(zoomedIn).toBeGreaterThan(parseInt(start))

    click(byLabel("Zoom out"))
    expect(parseInt(text(readout()))).toBeLessThan(zoomedIn)

    click(byLabel("Fit to window"))
    expect(text(readout())).toBe(start)
  })

  it("opens a menu from the readout and zooms to 100%", () => {
    mountLayout()
    // A large image, so 100% is a real zoom in rather than below the fit.
    loadImages(document.body, { w: 2400, h: 1632 })
    act(() => {
      readout().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }))
    })

    const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    expect(items.map((item) => item.textContent)).toEqual(["Zoom inCtrl +", "Zoom outCtrl -", "Zoom to 100%", "Fit to windowCtrl 0"])
    click(items[2])
    expect(text(readout())).toContain("100%")
  })

  it("turns Show masks on and off from the button", () => {
    mountLayout()
    const toggle = () => byLabel("Show masks")
    expect(toggle().getAttribute("aria-pressed")).toBe("false")
    click(toggle())
    expect(toggle().getAttribute("aria-pressed")).toBe("true")
    click(toggle())
    expect(toggle().getAttribute("aria-pressed")).toBe("false")
  })

  it("keeps the minimap out", () => {
    mountLayout()
    expect(document.querySelector('[aria-label*="map" i]')).toBeNull()
  })
})

describe("mask context menu", () => {
  function contextMenuAt(fx: number, fy: number): void {
    const { x, y, w, h } = frame()
    const pane = document.querySelector('[data-testid="occlusion-editor-stage"]')!
    const at = { clientX: x + fx * w, clientY: y + fy * h }
    act(() => {
      const down = new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 2, buttons: 2, ...at })
      pane.dispatchEvent(down)
      pane.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, ...at }))
    })
  }
  const items = () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]

  it("opens on a mask, selects it and offers the six items", () => {
    mountLayout({ draft: draftWith(three()) })
    contextMenuAt(0.5, 0.2)

    expect(items().map((item) => item.textContent?.replace(/(F2|Ctrl [A-Z]|Alt Shift .|Del)$/, ""))).toEqual([
      "Rename",
      "Duplicate",
      "Group",
      "Move earlier",
      "Move later",
      "Delete",
    ])
    expect(rows()[1].getAttribute("aria-selected")).toBe("true")
    expect(items()[2].getAttribute("aria-disabled")).toBe("true")
  })

  it("stays shut over empty image", () => {
    mountLayout({ draft: draftWith(three()) })
    contextMenuAt(0.05, 0.9)
    expect(items()).toHaveLength(0)
  })

  it("duplicates from the menu", () => {
    const spies = mountLayout({ draft: draftWith(three()) })
    contextMenuAt(0.2, 0.2)
    click(items()[1])

    expect(masksOf(spies)).toHaveLength(4)
  })
})
