// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useFileDrop } from "./useFileDrop"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let over = false
const onDrop = vi.fn()

function Harness({ locked }: { locked: boolean }) {
  over = useFileDrop(true, locked, onDrop)
  return null
}

/** jsdom has no DragEvent constructor, so a plain event carries a stand-in transfer. */
function drag(type: "dragover" | "drop", types = ["Files"]) {
  const event = new Event(type, { bubbles: true, cancelable: true }) as Event & { dataTransfer: unknown }
  const dataTransfer = { types, dropEffect: "", files: [] }
  event.dataTransfer = dataTransfer
  act(() => {
    document.body.dispatchEvent(event)
  })
  return { event, dataTransfer }
}

let root: Root

beforeEach(() => {
  vi.useFakeTimers()
  onDrop.mockClear()
  root = createRoot(document.createElement("div"))
})

afterEach(() => {
  act(() => root.unmount())
  vi.useRealTimers()
})

describe("useFileDrop", () => {
  it("shows while files hover, hides once dragover stops, and hands over the drop", () => {
    act(() => root.render(<Harness locked={false} />))

    const { event } = drag("dragover")
    expect(event.defaultPrevented).toBe(true)
    expect(over).toBe(true)

    act(() => vi.advanceTimersByTime(450))
    expect(over).toBe(false)

    drag("dragover")
    drag("drop")
    expect(over).toBe(false)
    expect(onDrop).toHaveBeenCalledTimes(1)
  })

  it("ignores a drag without files and refuses one while locked", () => {
    act(() => root.render(<Harness locked />))

    expect(drag("dragover", ["text/plain"]).event.defaultPrevented).toBe(false)
    expect(drag("dragover").dataTransfer.dropEffect).toBe("none")
    expect(over).toBe(false)

    drag("drop")
    expect(onDrop).not.toHaveBeenCalled()
  })
})
