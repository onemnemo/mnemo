// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"

import { dispatchAppEvent } from "./dispatch"
import { notifySubscribers, onAppEvent, resetSubscribersForTests } from "./subscribers"
import { EventType } from "./types"

afterEach(() => {
  resetSubscribersForTests()
})

describe("a subscriber", () => {
  it("hears only its own event type", () => {
    const heard = vi.fn()
    onAppEvent(EventType.MindmapChanged, heard)

    notifySubscribers({ type: EventType.MindmapChanged, data: { mapId: "m" } })
    notifySubscribers({ type: EventType.Hello, data: null })

    expect(heard).toHaveBeenCalledOnce()
  })

  it("stops hearing once it unsubscribes", () => {
    const heard = vi.fn()
    const off = onAppEvent(EventType.MindmapChanged, heard)
    off()

    notifySubscribers({ type: EventType.MindmapChanged, data: null })

    expect(heard).not.toHaveBeenCalled()
  })

  it("does not stop its neighbour by unsubscribing itself mid-notify", () => {
    // A page tearing down in response to an event is normal; iterating the live set would skip
    // whoever came after it.
    const second = vi.fn()
    const off = onAppEvent(EventType.MindmapChanged, () => off())
    onAppEvent(EventType.MindmapChanged, second)

    notifySubscribers({ type: EventType.MindmapChanged, data: null })

    expect(second).toHaveBeenCalledOnce()
  })

  it("is reached through the dispatcher, which has no case of its own for the type", () => {
    const heard = vi.fn()
    onAppEvent(EventType.MindmapChanged, heard)

    dispatchAppEvent({ type: EventType.MindmapChanged, data: { mapId: "m", revision: 4, kind: "edited" } })

    expect(heard).toHaveBeenCalledWith({
      type: EventType.MindmapChanged,
      data: { mapId: "m", revision: 4, kind: "edited" },
    })
  })
})
