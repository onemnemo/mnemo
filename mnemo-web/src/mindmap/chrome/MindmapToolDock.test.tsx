// @vitest-environment jsdom

/**
 * What a press on a tool does.
 *
 * Mounted rather than checked as a rule on its own, because the rule is one line and the thing worth
 * pinning is not the line: it is that pressing the shape tool puts eight shapes on screen. That used
 * to be true only of a hold, and a gesture with nothing on screen to suggest it is a feature nobody
 * has. A unit test of the line would have passed the whole time.
 *
 * The stores are left as they are rather than mocked. With no bundle loaded a translation is its own
 * key, which is what the labels below are, and with no catalog loaded a tool has no chord to draw.
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { MindmapToolDock, type MindmapToolDockProps } from "./MindmapToolDock"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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

function props(over: Partial<MindmapToolDockProps> = {}): MindmapToolDockProps {
  return {
    tool: "select",
    onTool: vi.fn(),
    zoom: 1,
    onZoomBy: vi.fn(),
    onZoomReset: vi.fn(),
    onFit: vi.fn(),
    shape: "rectangle",
    onShape: vi.fn(),
    onInsertImage: vi.fn(),
    ...over,
  }
}

function mount(over: Partial<MindmapToolDockProps> = {}): MindmapToolDockProps {
  const all = props(over)
  act(() => root.render(<MindmapToolDock {...all} />))
  return all
}

/** A control by its label, which with no bundle loaded is the translation key itself. */
function slot(label: string): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  expect(button, label).not.toBeNull()
  return button!
}

function press(label: string): void {
  act(() => slot(label).click())
}

/** Whether a panel is up, told by a value only that panel offers. */
const showing = (text: string) => container.textContent?.includes(text) === true

describe("the tool dock", () => {
  it("puts the shapes on screen when the shape tool is pressed", () => {
    const all = mount()

    press("ToolShape")

    expect(all.onTool).toHaveBeenCalledWith("shape")
    expect(showing("ShapeHexagon")).toBe(true)
    expect(showing("ShapeBlob")).toBe(true)
  })

  it("puts them away again when that same tool is pressed", () => {
    mount()

    press("ToolShape")
    press("ToolShape")

    expect(showing("ShapeHexagon")).toBe(false)
  })

  it("arms the shape that was picked, and gets out of the way of putting it somewhere", () => {
    const all = mount()
    press("ToolShape")

    const blob = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("ShapeBlob"),
    )
    act(() => blob!.click())

    expect(all.onShape).toHaveBeenCalledWith("blob")
    expect(showing("ShapeHexagon")).toBe(false)
  })

  it("puts the shapes away when a tool with no choices of its own is armed", () => {
    // The connect tool draws with one fixed style and owns no panel, so arming it is one of the
    // presses that should close whatever was open.
    mount()

    press("ToolShape")
    press("ToolConnect")

    expect(showing("ShapeHexagon")).toBe(false)
  })

  it("clears the choices when a tool that has none is armed", () => {
    mount()

    press("ToolShape")
    press("ToolNode")

    expect(showing("ShapeHexagon")).toBe(false)
  })

  it("says which tools have something behind them, and whether it is open", () => {
    mount()

    // The five that plant one thing carry no mark and make no claim about a panel.
    for (const label of ["ToolSelect", "ToolNode", "ToolText", "ToolConnect", "ToolFrame"]) {
      expect(slot(label).getAttribute("aria-haspopup"), label).toBeNull()
    }

    expect(slot("ToolShape").getAttribute("aria-haspopup")).toBe("menu")
    expect(slot("ToolShape").getAttribute("aria-expanded")).toBe("false")

    press("ToolShape")
    expect(slot("ToolShape").getAttribute("aria-expanded")).toBe("true")
  })

  it("wears the shape it will plant", () => {
    mount({ shape: "hexagon" })

    const face = slot("ToolShape").querySelector("svg[data-shape]")
    expect(face?.getAttribute("data-shape")).toBe("hexagon")
  })

  it("answers a letter while the shapes are up, and keeps that letter from the map", () => {
    const all = mount()
    press("ToolShape")

    const reachedMap = vi.fn()
    container.addEventListener("keydown", reachedMap)
    act(() => {
      container.dispatchEvent(new KeyboardEvent("keydown", { key: "h", bubbles: true, cancelable: true }))
    })

    expect(all.onShape).toHaveBeenCalledWith("hexagon")
    expect(showing("ShapeHexagon")).toBe(false)
    expect(reachedMap).not.toHaveBeenCalled()
  })

  it("leaves a letter alone once the shapes are away, and under a modifier", () => {
    const all = mount()
    press("ToolShape")

    act(() => {
      container.dispatchEvent(new KeyboardEvent("keydown", { key: "h", ctrlKey: true, bubbles: true }))
    })
    expect(all.onShape).not.toHaveBeenCalled()
    expect(showing("ShapeHexagon")).toBe(true)

    press("ToolShape")
    act(() => {
      container.dispatchEvent(new KeyboardEvent("keydown", { key: "b", bubbles: true }))
    })
    expect(all.onShape).not.toHaveBeenCalled()
  })

  it("takes the shapes down when another tool is armed from outside the dock", () => {
    const all = mount()
    press("ToolShape")
    expect(showing("ShapeHexagon")).toBe(true)

    act(() => root.render(<MindmapToolDock {...all} tool="text" />))

    expect(showing("ShapeHexagon")).toBe(false)
  })
})
