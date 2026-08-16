// @vitest-environment jsdom

import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useMeasuredWidth } from "./useMeasuredWidth"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** The observers currently attached, so a test can report a width the way the browser would. */
let observers: ((width: number) => void)[]
let container: HTMLElement
let root: Root
let reported: number[]
/** What a freshly attached element measures, standing in for jsdom's absent layout. */
let attachedWidth: number

/** Mirrors the shape every consumer has: the element only exists once the data has arrived. */
function Probe({ ready }: { ready: boolean }): ReactNode {
  const { ref, width } = useMeasuredWidth<HTMLDivElement>()
  reported.push(width)
  return ready ? <div ref={ref} /> : <span>loading</span>
}

function resizeTo(width: number): void {
  act(() => {
    for (const notify of observers) notify(width)
  })
}

beforeEach(() => {
  observers = []
  reported = []
  attachedWidth = 0
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)

  Object.defineProperty(HTMLDivElement.prototype, "clientWidth", {
    configurable: true,
    get: () => attachedWidth,
  })

  vi.stubGlobal(
    "ResizeObserver",
    class {
      callback: ResizeObserverCallback
      constructor(callback: ResizeObserverCallback) {
        this.callback = callback
      }
      observe() {
        observers.push((width) => {
          this.callback([{ contentRect: { width } } as ResizeObserverEntry], this as never)
        })
      }
      unobserve() {}
      disconnect() {
        observers = []
      }
    },
  )
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(HTMLDivElement.prototype, "clientWidth")
})

describe("useMeasuredWidth", () => {
  it("measures an element that only appears after the first render", () => {
    // The bug this exists for: a widget renders a skeleton first and its chart second. An effect
    // that ran at mount would have found nothing to observe and never looked again, leaving the
    // chart drawing itself into zero pixels.
    attachedWidth = 0
    act(() => root.render(<Probe ready={false} />))
    expect(reported.at(-1)).toBe(0)

    attachedWidth = 320
    act(() => root.render(<Probe ready={true} />))

    expect(reported.at(-1)).toBe(320)
  })

  it("follows the element as it resizes", () => {
    attachedWidth = 320
    act(() => root.render(<Probe ready={true} />))

    resizeTo(480)

    expect(reported.at(-1)).toBe(480)
  })

  it("keeps the last width when the element reports nothing", () => {
    // A hidden or detached element measures zero, which is not a width. Taking it would blank the
    // drawing on a route the user navigated away from and redraw it on the way back.
    attachedWidth = 320
    act(() => root.render(<Probe ready={true} />))

    resizeTo(0)

    expect(reported.at(-1)).toBe(320)
  })

  it("stops watching an element that goes away", () => {
    attachedWidth = 320
    act(() => root.render(<Probe ready={true} />))
    act(() => root.render(<Probe ready={false} />))

    expect(observers).toHaveLength(0)
  })
})
