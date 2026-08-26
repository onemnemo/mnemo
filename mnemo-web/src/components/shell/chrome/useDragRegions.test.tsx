// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useDragRegions } from "./useDragRegions"

const mocks = vi.hoisted(() => ({ report: vi.fn() }))

vi.mock("@/lib/window", () => ({
  isNativeWindow: true,
  reportDragRegions: mocks.report,
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function Harness() {
  useDragRegions()
  return null
}

let container: HTMLElement
let root: Root

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  mocks.report.mockClear()
})

afterEach(() => {
  act(() => root.unmount())
  document.body.innerHTML = ""
})

/** jsdom measures nothing, so each element carries its own answer. */
function box(element: HTMLElement, x: number, y: number, w: number, h: number): void {
  element.getBoundingClientRect = () =>
    ({ x, y, left: x, top: y, right: x + w, bottom: y + h, width: w, height: h, toJSON: () => ({}) }) as DOMRect
}

function mount(): void {
  act(() => root.render(<Harness />))
}

describe("useDragRegions", () => {
  it("publishes drag surfaces with their controls and floats carved out", () => {
    const bar = document.createElement("div")
    bar.className = "drag-region"
    box(bar, 0, 0, 1000, 48)
    const control = document.createElement("button")
    box(control, 960, 10, 32, 28)
    bar.appendChild(control)
    document.body.appendChild(bar)

    const opted = document.createElement("div")
    opted.className = "no-drag"
    box(opted, 600, 0, 50, 48)
    document.body.appendChild(opted)

    const popper = document.createElement("div")
    popper.setAttribute("data-radix-popper-content-wrapper", "")
    box(popper, 500, 100, 200, 150)
    document.body.appendChild(popper)

    mount()

    expect(mocks.report).toHaveBeenCalledTimes(1)
    expect(mocks.report).toHaveBeenCalledWith(
      [{ x: 0, y: 0, w: 1000, h: 48 }],
      [
        { x: 960, y: 10, w: 32, h: 28 },
        { x: 600, y: 0, w: 50, h: 48 },
        { x: 500, y: 100, w: 200, h: 150 },
      ],
    )
  })

  it("suspends dragging entirely while something modal is open", () => {
    const bar = document.createElement("div")
    bar.className = "drag-region"
    box(bar, 0, 0, 1000, 48)
    document.body.appendChild(bar)

    const dialog = document.createElement("div")
    dialog.setAttribute("aria-modal", "true")
    box(dialog, 200, 100, 400, 300)
    document.body.appendChild(dialog)

    mount()

    expect(mocks.report).toHaveBeenCalledWith([], [])
  })

  it("skips collapsed elements and rounds a fractional rectangle outward", () => {
    const bar = document.createElement("div")
    bar.className = "drag-region"
    box(bar, 10.4, 0.6, 30.2, 46.8)
    const collapsed = document.createElement("button")
    box(collapsed, 0, 0, 0, 28)
    bar.appendChild(collapsed)
    document.body.appendChild(bar)

    mount()

    expect(mocks.report).toHaveBeenCalledWith([{ x: 10, y: 0, w: 31, h: 48 }], [])
  })

  it("clamps a rectangle hanging past the viewport edge", () => {
    const bar = document.createElement("div")
    bar.className = "drag-region"
    box(bar, -10, -5, 100, 60)
    document.body.appendChild(bar)

    mount()

    expect(mocks.report).toHaveBeenCalledWith([{ x: 0, y: 0, w: 90, h: 55 }], [])
  })

  it("does not carve a hole for a float the pointer passes through", () => {
    const bar = document.createElement("div")
    bar.className = "drag-region"
    box(bar, 0, 0, 1000, 48)
    document.body.appendChild(bar)

    const tooltip = document.createElement("div")
    tooltip.className = "no-drag"
    tooltip.style.pointerEvents = "none"
    box(tooltip, 300, 20, 120, 30)
    document.body.appendChild(tooltip)

    mount()

    expect(mocks.report).toHaveBeenCalledWith([{ x: 0, y: 0, w: 1000, h: 48 }], [])
  })

  it("republishes when the document changes and stays quiet when nothing moved", async () => {
    const bar = document.createElement("div")
    bar.className = "drag-region"
    box(bar, 0, 0, 1000, 48)
    document.body.appendChild(bar)

    mount()
    expect(mocks.report).toHaveBeenCalledTimes(1)

    // A mutation that moves nothing: same rectangles, so no second message.
    const inert = document.createElement("div")
    box(inert, 0, 100, 10, 10)
    await act(async () => {
      document.body.appendChild(inert)
      await new Promise((resolve) => setTimeout(resolve, 80))
    })
    expect(mocks.report).toHaveBeenCalledTimes(1)

    // A mutation that adds a surface republishes the new set.
    const strip = document.createElement("div")
    strip.className = "drag-region"
    box(strip, 0, 48, 400, 40)
    await act(async () => {
      document.body.appendChild(strip)
      await new Promise((resolve) => setTimeout(resolve, 80))
    })
    expect(mocks.report).toHaveBeenCalledTimes(2)
    expect(mocks.report).toHaveBeenLastCalledWith(
      [
        { x: 0, y: 0, w: 1000, h: 48 },
        { x: 0, y: 48, w: 400, h: 40 },
      ],
      [],
    )
  })
})
