// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { useI18nStore } from "@/i18n/store"
import { useKeybindStore } from "@/keybinds/store"
import type { Keybind } from "@/keybinds/types"

import { englishMindmap } from "./panel/test-strings"
import { MOST_CUTOUTS, subAngle } from "./radial"
import { RadialMenu, type RadialMenuProps } from "./RadialMenu"
import { RadialScrim } from "./RadialScrim"
import { ON_CANVAS, onElements } from "./sectors"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const AT = { x: 400, y: 300 }
const ELEMENTS = onElements({ collapsed: false, pinned: false })

let container: HTMLElement
let root: Root

beforeAll(() => useI18nStore.setState({ bundle: { Mindmap: englishMindmap() } }))

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  useKeybindStore.getState().setKeybinds([])
})

function mount(props: Partial<RadialMenuProps> = {}) {
  const handlers = { onPick: vi.fn(), onClose: vi.fn() }
  act(() =>
    root.render(<RadialMenu sectors={ON_CANVAS} at={AT} holdKey="Q" subject="Canvas" {...handlers} {...props} />),
  )
  return handlers
}

/** Moves the pointer `radius` out from the ring's centre at `degrees` clockwise from straight up. */
function point(degrees: number, radius: number) {
  const angle = (degrees * Math.PI) / 180
  act(() => {
    window.dispatchEvent(
      new MouseEvent("pointermove", {
        clientX: AT.x + Math.sin(angle) * radius,
        clientY: AT.y - Math.cos(angle) * radius,
      }),
    )
  })
}

const release = () => act(() => void window.dispatchEvent(new KeyboardEvent("keyup", { key: "q", code: "KeyQ" })))
const hub = () => container.querySelector("[aria-live]")!.textContent
const over = () => container.querySelector("[aria-live]")!.previousElementSibling?.textContent

describe("the radial ring", () => {
  it("names what it acts on at rest, and the hot sector once the pointer moves out", () => {
    mount()
    expect(hub()).toBe("Canvas")
    point(0, 90)
    expect(hub()).toBe("Add node")
  })

  it("picks a sector with no sub-ring on release, and says which sector it came from", () => {
    const { onPick, onClose } = mount()
    point(90, 90)
    release()
    expect(onPick).toHaveBeenCalledWith("text", "text")
    expect(onClose).toHaveBeenCalled()
  })

  it("picks the sub item under the pointer after going out through its sector", () => {
    const { onPick } = mount()
    point(45, 90)
    point(45, 164)
    point(subAngle(1, 8, 2, 8), 164)
    expect(hub()).toBe("Diamond")
    release()
    expect(onPick).toHaveBeenCalledWith("shape:diamond", "shape")
  })

  it("asks for a choice on a sector whose sub-ring was never picked from, and picks nothing there", () => {
    const { onPick, onClose } = mount({ sectors: ELEMENTS })
    point(0, 90)
    expect(over()).toBe("Branch color")
    expect(hub()).toBe("Move out to choose")
    release()
    expect(onPick).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it("repeats the last item picked when released on its sector", () => {
    const { onPick } = mount({ sectors: ELEMENTS, remembered: (id) => (id === "color" ? "color:2" : null) })
    point(0, 90)
    expect(hub()).toBe("Color 3")
    release()
    expect(onPick).toHaveBeenCalledWith("color:2", "color")
  })

  it("names a dimmed sector without picking it", () => {
    const { onPick, onClose } = mount({ sectors: ELEMENTS, inert: new Set(["connect"]) })
    point(90, 90)
    expect(hub()).toBe("Connect")
    release()
    expect(onPick).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it("cancels on a release over the hub, and on Escape", () => {
    const hubRelease = mount()
    point(0, 90)
    point(0, 20)
    release()
    expect(hubRelease.onPick).not.toHaveBeenCalled()

    const escape = mount()
    point(0, 90)
    act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })))
    expect(escape.onPick).not.toHaveBeenCalled()
    expect(escape.onClose).toHaveBeenCalled()
  })

  it("closes with nothing picked when the window loses focus mid-hold", () => {
    const { onPick, onClose } = mount()
    point(90, 90)
    act(() => void window.dispatchEvent(new Event("blur")))
    expect(onClose).toHaveBeenCalled()
    expect(onPick).not.toHaveBeenCalled()
  })

  it("commits on a press without letting the press reach the pane underneath", () => {
    const { onPick } = mount()
    const pane = vi.fn()
    container.addEventListener("pointerdown", pane)
    point(90, 90)
    act(() => void container.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })))
    expect(onPick).toHaveBeenCalledWith("text", "text")
    expect(pane).not.toHaveBeenCalled()
  })

  it("shows the chord the catalog binds, and none for a sector with no action", () => {
    useKeybindStore.getState().setKeybinds([
      { actionId: "mindmap.new-node", bindings: [{ kind: "Chord", chord: "N" }] } as Keybind,
    ])
    mount()
    point(0, 90)
    expect(container.querySelector("[aria-live]")!.nextElementSibling?.textContent).toBe("N")
    point(270, 90)
    expect(hub()).toBe("Move out to choose")
    expect(container.querySelector("[aria-live]")!.nextElementSibling).toBeNull()
  })
})

describe("the scrim", () => {
  const subpaths = () => (container.querySelector("path")!.getAttribute("d")!.match(/M/g) ?? []).length
  const box = { x: 10, y: 10, width: 40, height: 20 }

  it("cuts each target's box out of the dimmed canvas", () => {
    act(() => root.render(<RadialScrim cutouts={[box, { ...box, x: 100 }]} />))
    expect(subpaths()).toBe(3)
  })

  it("cuts nothing out past the limit", () => {
    act(() => root.render(<RadialScrim cutouts={Array.from({ length: MOST_CUTOUTS + 1 }, () => box)} />))
    expect(subpaths()).toBe(1)
  })
})
