// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ArrangeCount } from "../api"
import { MapStyleMenu, type MapStyleMenuProps } from "./MapStyleMenu"
import { ARRANGE_COUNT_DELAY } from "./useArrangeCount"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLElement
let root: Root

beforeEach(() => {
  vi.useFakeTimers()
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.body.innerHTML = ""
  vi.useRealTimers()
})

/** A count the test answers by hand, so replies can land late and out of order. */
function pending() {
  const asks: { resolve: (reply: ArrangeCount | null) => void; signal: AbortSignal }[] = []
  const countArrange = vi.fn(
    (signal: AbortSignal) => new Promise<ArrangeCount | null>((resolve) => asks.push({ resolve, signal })),
  )
  return { countArrange, asks }
}

const SIZES = {}

function props(over: Partial<MapStyleMenuProps>): MapStyleMenuProps {
  return {
    algorithm: "balanced",
    onAlgorithm: vi.fn(),
    onArrange: vi.fn(),
    canArrange: true,
    revision: 3,
    sizesKey: SIZES,
    countArrange: vi.fn(async () => null),
    material: "taper",
    onMaterial: vi.fn(),
    templates: [],
    templateId: null,
    onTemplate: vi.fn(),
    builtInIds: [],
    onDeleteTemplate: vi.fn(),
    background: "dots",
    onBackground: vi.fn(),
    ...over,
  }
}

function render(all: MapStyleMenuProps) {
  act(() => root.render(<MapStyleMenu {...all} />))
}

function open() {
  const trigger = container.querySelector<HTMLButtonElement>('button[title="MapStyle"]')!
  act(() => {
    trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }))
    trigger.click()
  })
}

const settle = () => act(() => vi.advanceTimersByTime(ARRANGE_COUNT_DELAY))

const arrangeNow = () =>
  [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "ArrangeNow")!

const tooltip = () => arrangeNow().closest<HTMLElement>("[data-tooltip]")!.dataset.tooltip

async function answer(resolve: (reply: ArrangeCount | null) => void, reply: ArrangeCount | null) {
  await act(async () => resolve(reply))
}

describe("MapStyleMenu's Arrange now", () => {
  it("asks only once the menu has been open a moment, and is disabled when nothing would move", async () => {
    const { countArrange, asks } = pending()
    render(props({ countArrange }))
    open()
    expect(countArrange).not.toHaveBeenCalled()

    settle()
    expect(countArrange).toHaveBeenCalledTimes(1)
    // Unknown is usable, so a slow or failed count never locks the button out.
    expect(arrangeNow().disabled).toBe(false)

    await answer(asks[0].resolve, { revision: 3, moves: 0 })
    expect(arrangeNow().disabled).toBe(true)
    expect(tooltip()).toBe("AlreadyArranged")
  })

  it("stays usable when an arrange would move something, and arranges under the current arrangement", async () => {
    const { countArrange, asks } = pending()
    const all = props({ countArrange })
    render(all)
    open()
    settle()
    await answer(asks[0].resolve, { revision: 3, moves: 2 })

    expect(arrangeNow().disabled).toBe(false)
    expect(tooltip()).toBe("LayoutTooltip")
    act(() => arrangeNow().click())
    expect(all.onArrange).toHaveBeenCalledWith()
  })

  it("asks again for a new revision, aborting the request it supersedes and ignoring its reply", async () => {
    const { countArrange, asks } = pending()
    const all = props({ countArrange })
    render(all)
    open()
    settle()
    render({ ...all, revision: 4 })
    expect(asks[0].signal.aborted).toBe(true)
    settle()
    expect(countArrange).toHaveBeenCalledTimes(2)

    await answer(asks[0].resolve, { revision: 3, moves: 0 })
    expect(arrangeNow().disabled).toBe(false)

    await answer(asks[1].resolve, { revision: 4, moves: 0 })
    expect(arrangeNow().disabled).toBe(true)
  })

  it("asks again when the sizes change without a new revision", async () => {
    const { countArrange, asks } = pending()
    const all = props({ countArrange })
    render(all)
    open()
    settle()
    await answer(asks[0].resolve, { revision: 3, moves: 0 })
    expect(arrangeNow().disabled).toBe(true)

    // A font load or a restyle: same revision, different measurements, so the old count no longer holds.
    render({ ...all, sizesKey: {} })
    expect(arrangeNow().disabled).toBe(false)
    settle()
    expect(countArrange).toHaveBeenCalledTimes(2)
  })

  it("sends one request for a burst of changes", () => {
    const { countArrange } = pending()
    const all = props({ countArrange })
    render(all)
    open()
    render({ ...all, sizesKey: {} })
    render({ ...all, sizesKey: {}, revision: 4 })
    settle()

    expect(countArrange).toHaveBeenCalledTimes(1)
  })

  it("never asks about an empty map, and names what the button does rather than calling it arranged", () => {
    const { countArrange } = pending()
    render(props({ countArrange, canArrange: false }))
    open()
    settle()

    expect(countArrange).not.toHaveBeenCalled()
    expect(arrangeNow().disabled).toBe(true)
    expect(tooltip()).toBe("LayoutTooltip")
  })

  it("is not disabled just because the arrangement is Free", async () => {
    const { countArrange, asks } = pending()
    render(props({ countArrange, algorithm: "free" }))
    open()
    settle()
    await answer(asks[0].resolve, { revision: 3, moves: 1 })

    expect(arrangeNow().disabled).toBe(false)
  })
})
