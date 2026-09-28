// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { PanelBar } from "./PanelBar"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// jsdom lays nothing out, so the pane, the bar and the panel are given the geometry under test.
const PANE = { top: 0, bottom: 600 }
const PANEL_HEIGHT = 200

let barTop = 0
/** How much smaller the bar is drawn than it is laid out, as zooming out makes it. */
let barScale = 1
let container: HTMLElement
let root: Root

beforeEach(() => {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const box = this.matches("[data-mm-pane]")
      ? PANE
      : this.matches('[role="toolbar"]')
        ? { top: barTop, bottom: barTop + 40 * barScale }
        : { top: 0, bottom: 0 }
    const height = box.bottom - box.top
    return { ...box, left: 0, right: 0, width: 0, height, x: 0, y: box.top, toJSON: () => box } as DOMRect
  })
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
    const role = this.getAttribute("role")
    return role === "dialog" ? PANEL_HEIGHT : role === "toolbar" ? 40 : 0
  })
  container = document.createElement("div")
  container.setAttribute("data-mm-pane", "")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

function openAt(top: number, scale = 1) {
  barTop = top
  barScale = scale
  // A fresh mount, since a panel is only measured again once the bar moves.
  act(() => root.render(null))
  act(() =>
    root.render(
      <PanelBar label="Bar" width={272} open="a" onClose={() => {}} panels={[{ key: "a", label: "A", content: "a" }]}>
        <button type="button">x</button>
      </PanelBar>,
    ),
  )
  return container.querySelector<HTMLElement>('[role="dialog"]')!
}

describe("where a panel opens", () => {
  it("opens above the bar when there is room", () => {
    const panel = openAt(400)
    expect(panel.style.bottom).not.toBe("")
    expect(panel.style.top).toBe("")
  })

  it("opens below the bar when there is no room above it", () => {
    const panel = openAt(40)
    expect(panel.style.top).not.toBe("")
    expect(panel.style.bottom).toBe("")
    // A panel below grows from its top edge, the one against the bar.
    expect(panel.style.transformOrigin).toBe("50% 0%")
  })

  it("measures the panel at the size it is drawn when the bar is shrunk", () => {
    // 170px above the bar fits a 200px panel drawn at 70%, but not the same panel at full size.
    expect(openAt(170, 0.7).style.bottom).not.toBe("")
    expect(openAt(170, 1).style.top).not.toBe("")
  })
})
