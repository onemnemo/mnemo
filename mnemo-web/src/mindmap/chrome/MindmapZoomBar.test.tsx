// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ZOOM_STEP } from "../canvas/camera"
import { MindmapZoomBar } from "./MindmapZoomBar"

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

describe("the zoom bar", () => {
  it("zooms, resets, fits, and reads out the zoom", () => {
    const handlers = { onZoomBy: vi.fn(), onZoomReset: vi.fn(), onFit: vi.fn() }
    act(() => root.render(<MindmapZoomBar zoom={1.5} {...handlers} />))
    const press = (label: string) =>
      act(() => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click())

    press("ZoomIn")
    press("ZoomOut")
    press("ResetZoom")
    press("FitToScreenTooltip")

    expect(handlers.onZoomBy).toHaveBeenNthCalledWith(1, ZOOM_STEP)
    expect(handlers.onZoomBy).toHaveBeenNthCalledWith(2, 1 / ZOOM_STEP)
    expect(handlers.onZoomReset).toHaveBeenCalledOnce()
    expect(handlers.onFit).toHaveBeenCalledOnce()
    expect(container.textContent).toContain("150%")
  })
})
