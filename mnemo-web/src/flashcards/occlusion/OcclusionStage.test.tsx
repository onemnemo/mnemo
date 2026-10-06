// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { FIT_VIEW, type View } from "./geometry"
import { OcclusionStage } from "./OcclusionStage"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock("@/i18n/useT", () => ({ useT: () => (_ns: string, key: string) => key }))

const BOX = { w: 656, h: 403 }
const FITTED = { w: 593, h: 403 }
const ZOOMED: View = { scale: 2, cx: 0.5, cy: 0.5 }

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function mount(view: View, onViewChange: (view: View) => void) {
  act(() =>
    root.render(
      <OcclusionStage
        masks={[]}
        askedIds={[]}
        mode="hideAll"
        side="front"
        showMasks={false}
        imageUrl="blob:x"
        image={{ natural: { w: 1000, h: 680 }, failed: false, onLoad: () => {}, onError: () => {} }}
        box={BOX}
        fitted={FITTED}
        view={view}
        onViewChange={onViewChange}
        label="stage"
      />,
    ),
  )
}

function pointer(type: string, x: number, buttons: number): void {
  const stage = host.querySelector('[data-testid="occlusion-stage"]')!
  act(() => {
    stage.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: 100, button: 0, buttons }))
  })
}

describe("OcclusionStage panning", () => {
  it("applies the travel that crossed the drag threshold, not only what came after", () => {
    const change = vi.fn()
    mount(ZOOMED, change)

    pointer("pointerdown", 100, 1)
    pointer("pointermove", 103, 1)
    expect(change).not.toHaveBeenCalled()
    pointer("pointermove", 110, 1)

    expect(change).toHaveBeenCalledTimes(1)
    // 10px of pointer travel moves the centre by 10px of the 1186px zoomed image, to the left.
    expect(change.mock.calls[0][0].cx).toBeCloseTo(0.5 - 10 / 1186, 5)
  })

  it("stops panning once a move arrives with no button held", () => {
    const change = vi.fn()
    mount(ZOOMED, change)

    pointer("pointerdown", 100, 1)
    pointer("pointermove", 140, 1)
    expect(change).toHaveBeenCalledTimes(1)

    pointer("pointermove", 200, 0)
    pointer("pointermove", 260, 0)
    expect(change).toHaveBeenCalledTimes(1)
  })

  it("stops panning after a cancel", () => {
    const change = vi.fn()
    mount(ZOOMED, change)

    pointer("pointerdown", 100, 1)
    pointer("pointermove", 140, 1)
    pointer("pointercancel", 140, 0)
    pointer("pointermove", 200, 1)

    expect(change).toHaveBeenCalledTimes(1)
  })

  it("does not pan at fit", () => {
    const change = vi.fn()
    mount(FIT_VIEW, change)

    pointer("pointerdown", 100, 1)
    pointer("pointermove", 160, 1)

    expect(change).not.toHaveBeenCalled()
  })
})
