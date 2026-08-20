// @vitest-environment jsdom

/**
 * EventStreamProvider under StrictMode's deliberate mount/unmount/mount double-invoke: the first
 * connection is opened and torn down again before the second, surviving one is even created. A
 * callback that still arrives from that discarded connection - a late open, a late close, a late
 * event - must never be mistaken for one from the connection that replaced it.
 */

import { StrictMode, act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { AppEvent } from "./types"

interface StreamHandlers {
  onEvent: (event: AppEvent) => void
  onOpen?: () => void
  onClose?: () => void
}

const mocks = vi.hoisted(() => ({
  connectEventStream: vi.fn(),
  dispatchAppEvent: vi.fn(),
}))

vi.mock("./sse-client", () => ({ connectEventStream: mocks.connectEventStream }))
vi.mock("./dispatch", () => ({ dispatchAppEvent: mocks.dispatchAppEvent }))

import { EventStreamProvider } from "./EventStreamProvider"
import { useEventStreamStore } from "./store"

// React's `act` refuses to run unless the environment declares itself a test one.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLElement
let root: Root
let disposed: boolean

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  disposed = false
  mocks.connectEventStream.mockReset()
  mocks.connectEventStream.mockImplementation(() => vi.fn())
  mocks.dispatchAppEvent.mockReset()
  useEventStreamStore.setState({ status: "connecting" })
})

/** Unmount once, whether the test did it or the teardown does; roots warn on a double unmount. */
function dispose(): void {
  if (disposed) return
  disposed = true
  act(() => root.unmount())
}

afterEach(() => {
  dispose()
  container.remove()
})

function handlersFor(call: number): StreamHandlers {
  return mocks.connectEventStream.mock.calls[call]?.[0] as StreamHandlers
}

describe("EventStreamProvider", () => {
  it("opens one connection per effect invocation, discarding the first under StrictMode", () => {
    act(() => {
      root.render(
        <StrictMode>
          <EventStreamProvider>content</EventStreamProvider>
        </StrictMode>,
      )
    })

    expect(mocks.connectEventStream).toHaveBeenCalledTimes(2)
  })

  it("ignores status callbacks from the connection StrictMode already discarded", () => {
    act(() => {
      root.render(
        <StrictMode>
          <EventStreamProvider>content</EventStreamProvider>
        </StrictMode>,
      )
    })

    const discarded = handlersFor(0)
    const surviving = handlersFor(1)

    act(() => discarded.onOpen?.())
    // The discarded connection's own open must not mark the stream live.
    expect(useEventStreamStore.getState().status).toBe("connecting")

    act(() => surviving.onOpen?.())
    expect(useEventStreamStore.getState().status).toBe("open")

    act(() => discarded.onClose?.())
    // Nor may its close knock down the status the surviving connection just set.
    expect(useEventStreamStore.getState().status).toBe("open")

    act(() => surviving.onClose?.())
    expect(useEventStreamStore.getState().status).toBe("closed")
  })

  it("delivers an event only from the connection that is still current", () => {
    act(() => {
      root.render(
        <StrictMode>
          <EventStreamProvider>content</EventStreamProvider>
        </StrictMode>,
      )
    })

    const discarded = handlersFor(0)
    const surviving = handlersFor(1)

    act(() => discarded.onEvent({ type: "hello", data: null }))
    expect(mocks.dispatchAppEvent).not.toHaveBeenCalled()

    act(() => surviving.onEvent({ type: "hello", data: null }))
    expect(mocks.dispatchAppEvent).toHaveBeenCalledTimes(1)
    expect(mocks.dispatchAppEvent).toHaveBeenCalledWith({ type: "hello", data: null })
  })

  it("disposes both connections on unmount", () => {
    const disposers = [vi.fn(), vi.fn()]
    mocks.connectEventStream.mockImplementationOnce(() => disposers[0])
    mocks.connectEventStream.mockImplementationOnce(() => disposers[1])

    act(() => {
      root.render(
        <StrictMode>
          <EventStreamProvider>content</EventStreamProvider>
        </StrictMode>,
      )
    })

    // The first invocation's disposer already ran as part of StrictMode's own
    // mount/unmount/mount, so only the survivor's teardown is still pending here.
    expect(disposers[0]).toHaveBeenCalledTimes(1)
    expect(disposers[1]).not.toHaveBeenCalled()

    dispose()
    expect(disposers[1]).toHaveBeenCalledTimes(1)
  })
})
