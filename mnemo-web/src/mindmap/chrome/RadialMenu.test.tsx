// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { useI18nStore } from "@/i18n/store"
import { useKeybindStore } from "@/keybinds/store"
import type { Keybind } from "@/keybinds/types"

import { englishMindmap } from "./panel/test-strings"
import { MOST_CUTOUTS, subAngle } from "./radial"
import { RadialMenu } from "./RadialMenu"
import { RadialScrim } from "./RadialScrim"
import { ON_CANVAS, onNode } from "./sectors"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const AT = { x: 400, y: 300 }

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

function mount(sectors = ON_CANVAS, inert: ReadonlySet<string> = new Set()) {
  const handlers = { onPick: vi.fn(), onClose: vi.fn() }
  act(() =>
    root.render(<RadialMenu sectors={sectors} inert={inert} at={AT} holdKey="Q" subject="Canvas" {...handlers} />),
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

describe("the radial ring", () => {
  it("names what it acts on at rest, and the hot sector once the pointer moves out", () => {
    mount()
    expect(hub()).toBe("Canvas")
    point(0, 90)
    expect(hub()).toBe("Add node")
  })

  it("picks a sector with no sub-ring on release", () => {
    const { onPick, onClose } = mount()
    point(120, 90)
    release()
    expect(onPick).toHaveBeenCalledWith("text")
    expect(onClose).toHaveBeenCalled()
  })

  it("picks the sub item under the pointer past the rim", () => {
    const { onPick } = mount()
    point(60, 164)
    point(subAngle(1, 6, 2, 8), 164)
    expect(hub()).toBe("Diamond")
    release()
    expect(onPick).toHaveBeenCalledWith("shape:diamond")
  })

  it("keeps a sub-ring's parent while sliding along it into another sector's angle", () => {
    const { onPick } = mount()
    point(60, 164)
    point(subAngle(1, 6, 7, 8), 164)
    release()
    expect(onPick).toHaveBeenCalledWith("shape:blob")
  })

  it("runs a sector's own action when released on the sector, and nothing for one that only opens its sub-ring", () => {
    const layout = mount()
    point(240, 90)
    release()
    expect(layout.onPick).toHaveBeenCalledWith("arrange")

    const insert = mount()
    point(180, 90)
    expect(hub()).toBe("Insert")
    release()
    expect(insert.onPick).not.toHaveBeenCalled()
    expect(insert.onClose).toHaveBeenCalled()
  })

  it("cancels on a release over the hub", () => {
    const { onPick, onClose } = mount()
    point(0, 90)
    point(0, 20)
    release()
    expect(onPick).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it("cancels on Escape", () => {
    const { onPick, onClose } = mount()
    point(0, 90)
    act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })))
    expect(onPick).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it("commits on a press without letting the press reach the pane underneath", () => {
    const { onPick } = mount()
    const pane = vi.fn()
    container.addEventListener("pointerdown", pane)
    point(120, 90)
    act(() => void container.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })))
    expect(onPick).toHaveBeenCalledWith("text")
    expect(pane).not.toHaveBeenCalled()
  })

  it("never lights or picks a dimmed sector", () => {
    const sectors = onNode(false)
    const { onPick, onClose } = mount(sectors, new Set(["child"]))
    point(0, 90)
    expect(hub()).toBe("Canvas")
    release()
    expect(onPick).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it("shows the chord the catalog binds, and none for a sector with no action", () => {
    useKeybindStore.getState().setKeybinds([
      { actionId: "mindmap.add-child", bindings: [{ kind: "Chord", chord: "Tab" }] } as Keybind,
    ])
    mount(onNode(false))
    point(0, 90)
    const chip = container.querySelector("[aria-live]")!.nextElementSibling
    expect(chip?.textContent).toBe("Tab")

    // Color has no catalog action at all.
    point(80, 90)
    expect(hub()).toBe("Branch color")
    expect(container.querySelector("[aria-live]")!.nextElementSibling).toBeNull()
  })
})

describe("the scrim", () => {
  const subpaths = () => (container.querySelector("path")!.getAttribute("d")!.match(/M/g) ?? []).length
  const box = { x: 10, y: 10, width: 40, height: 20 }

  it("cuts each selected box out of the dimmed canvas", () => {
    act(() => root.render(<RadialScrim cutouts={[box, { ...box, x: 100 }]} />))
    expect(subpaths()).toBe(3)
  })

  it("cuts nothing out past the limit", () => {
    act(() => root.render(<RadialScrim cutouts={Array.from({ length: MOST_CUTOUTS + 1 }, () => box)} />))
    expect(subpaths()).toBe(1)
  })
})
