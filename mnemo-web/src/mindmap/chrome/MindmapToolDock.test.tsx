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
    connectStyle: { line: "solid", routing: "curve", startCap: "none", endCap: "arrow" },
    onConnectStyle: vi.fn(),
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

  it("keeps the connect tool's four values up, since one press does not finish setting them", () => {
    const all = mount()
    press("ToolConnect")

    // A style cell is a picture of the value with its name only on the label, so it is asked for by
    // that rather than by what it reads as.
    press("EdgeDotted")

    expect(all.onConnectStyle).toHaveBeenCalledWith({ line: "dotted" })
    expect(showing("EdgeLine")).toBe(true)
  })

  it("shows one tool's choices at a time", () => {
    mount()

    press("ToolShape")
    press("ToolConnect")

    expect(showing("ShapeHexagon")).toBe(false)
    expect(showing("EdgeLine")).toBe(true)
  })

  it("clears the choices when a tool that has none is armed", () => {
    mount()

    press("ToolShape")
    press("ToolNode")

    expect(showing("ShapeHexagon")).toBe(false)
  })

  it("says which tools have something behind them, and whether it is open", () => {
    mount()

    // The four that plant one thing carry no mark and make no claim about a panel.
    for (const label of ["ToolSelect", "ToolNode", "ToolText", "ToolFrame"]) {
      expect(slot(label).getAttribute("aria-haspopup"), label).toBeNull()
    }

    expect(slot("ToolShape").getAttribute("aria-haspopup")).toBe("menu")
    expect(slot("ToolShape").getAttribute("aria-expanded")).toBe("false")

    press("ToolShape")
    expect(slot("ToolShape").getAttribute("aria-expanded")).toBe("true")
  })
})
