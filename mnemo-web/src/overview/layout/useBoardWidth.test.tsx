// @vitest-environment jsdom

import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { installControllableResizeObserver, type ResizeObserverController } from "@/test/setup"

import { useBoardWidth } from "./useBoardWidth"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let resizeObserver: ResizeObserverController
let container: HTMLElement
let root: Root
let reported: number[]

function Probe(): ReactNode {
  const { ref, columnCount } = useBoardWidth<HTMLDivElement>()
  reported.push(columnCount)
  return <div ref={ref} />
}

function resizeTo(width: number): void {
  act(() => {
    resizeObserver.trigger(width)
  })
}

beforeEach(() => {
  reported = []
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)

  resizeObserver = installControllableResizeObserver()
})

// Not StrictMode: the double-invoked render would push each bucket twice and the last-value
// assertions below would stop saying anything about how often the hook actually re-renders.
// Mounting per test rather than in beforeEach, because the hook measures once on mount and a test
// that wants a different starting width has to set it before that mount, not after.
function mount(): void {
  act(() => root.render(<Probe />))
}

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

const latest = () => reported[reported.length - 1]

/** jsdom lays nothing out, so clientWidth is always 0 unless a test says otherwise. */
function withClientWidth(width: number, body: () => void): void {
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth")
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => width })
  try {
    body()
  } finally {
    if (original === undefined) delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth
    else Object.defineProperty(HTMLElement.prototype, "clientWidth", original)
  }
}

describe("useBoardWidth", () => {
  it("starts at the widest bucket, so an unmeasured board does not paint stacked", () => {
    mount()
    expect(latest()).toBe(4)
  })

  it("corrects the bucket from the element itself, without waiting for an observer callback", () => {
    // The observer's first callback is a frame away. A narrow board that waited for it would paint
    // four columns and snap, which is the same flash the fallback width exists to prevent.
    withClientWidth(700, mount)

    expect(resizeObserver.observedCount).toBe(1)
    expect(latest()).toBe(2)
  })

  it.each([
    [1024, 4],
    [1023, 2],
    [560, 2],
    [559, 1],
    [320, 1],
  ])("reports %ipx as %i columns", (width, columns) => {
    mount()
    resizeTo(width)
    expect(latest()).toBe(columns)
  })

  it("does not re-render while the width moves inside one bucket", () => {
    mount()
    resizeTo(1200)
    const renders = reported.length

    resizeTo(1400)
    resizeTo(1100)
    resizeTo(1024)

    // Same bucket every time, so the identity React sees never changes and no tile is re-rendered
    // for a width that CSS already handled.
    expect(reported.length).toBe(renders)
    expect(latest()).toBe(4)
  })

  it("holds the last bucket when the board reports no width at all", () => {
    mount()
    resizeTo(800)
    // A detached or display:none board measures 0, which is not a one-column board. Re-bucketing
    // on it would reflow the whole grid on the way back to a route that never changed size.
    resizeTo(0)

    expect(latest()).toBe(2)
  })
})
