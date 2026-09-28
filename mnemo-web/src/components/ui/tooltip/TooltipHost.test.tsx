// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { TooltipHost } from "./TooltipHost"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ""
})

describe("TooltipHost", () => {
  it("draws a second line under the label", () => {
    vi.useFakeTimers()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() => root.render(<TooltipHost />))
    const anchor = document.createElement("button")
    anchor.dataset.tooltip = "Minimap: On"
    anchor.dataset.tooltipDetail = "Click for Auto"
    document.body.appendChild(anchor)

    act(() => {
      anchor.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }))
      vi.advanceTimersByTime(500)
    })

    const tip = document.body.querySelector('[role="presentation"]')!
    const lines = [...tip.querySelectorAll("span > span")].map((line) => line.textContent)
    expect(lines).toEqual(["Minimap: On", "Click for Auto"])
    act(() => root.unmount())
  })
})
