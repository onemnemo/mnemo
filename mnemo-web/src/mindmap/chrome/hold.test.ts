// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { HOLD_MS, createHold } from "./hold"

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

/** A gesture and the two counters it resolves into, since every case here is about which one moved. */
function harness() {
  const onTap = vi.fn()
  const onHold = vi.fn()
  return { onTap, onHold, hold: createHold({ onTap, onHold }) }
}

const press = (pointerId = 1) => ({ pointerId })

describe("a short press", () => {
  it("taps", () => {
    const { hold, onTap, onHold } = harness()

    hold.onPointerDown(press())
    vi.advanceTimersByTime(HOLD_MS - 1)
    hold.onPointerUp()

    expect(onTap).toHaveBeenCalledTimes(1)
    expect(onHold).not.toHaveBeenCalled()
  })
})

describe("a long press", () => {
  it("holds while the button is still down", () => {
    const { hold, onTap, onHold } = harness()

    hold.onPointerDown(press())
    vi.advanceTimersByTime(HOLD_MS)

    expect(onHold).toHaveBeenCalledTimes(1)
    expect(onTap).not.toHaveBeenCalled()
  })

  it("does not tap on the release that follows it", () => {
    const { hold, onTap, onHold } = harness()

    hold.onPointerDown(press())
    vi.advanceTimersByTime(HOLD_MS)
    hold.onPointerUp()

    expect(onHold).toHaveBeenCalledTimes(1)
    expect(onTap).not.toHaveBeenCalled()
  })

  it("stays held when the pointer travels off the control onto whatever it opened", () => {
    const { hold, onTap, onHold } = harness()

    hold.onPointerDown(press())
    vi.advanceTimersByTime(HOLD_MS)
    hold.onPointerLeave()
    hold.onPointerUp()

    expect(onHold).toHaveBeenCalledTimes(1)
    expect(onTap).not.toHaveBeenCalled()
  })
})

describe("leaving mid-press", () => {
  it("does neither, and the timer does not fire afterwards", () => {
    const { hold, onTap, onHold } = harness()

    hold.onPointerDown(press())
    vi.advanceTimersByTime(HOLD_MS - 1)
    hold.onPointerLeave()
    vi.advanceTimersByTime(HOLD_MS)
    hold.onPointerUp()

    expect(onTap).not.toHaveBeenCalled()
    expect(onHold).not.toHaveBeenCalled()
  })
})

describe("cancel", () => {
  it("fires nothing, before or after the threshold would have passed", () => {
    const { hold, onTap, onHold } = harness()

    hold.onPointerDown(press())
    hold.cancel()
    vi.advanceTimersByTime(HOLD_MS * 2)
    hold.onPointerUp()

    expect(onTap).not.toHaveBeenCalled()
    expect(onHold).not.toHaveBeenCalled()
  })
})

describe("two presses in a row", () => {
  it("resolves each one on its own", () => {
    const { hold, onTap, onHold } = harness()

    hold.onPointerDown(press())
    vi.advanceTimersByTime(HOLD_MS - 1)
    hold.onPointerUp()

    hold.onPointerDown(press())
    vi.advanceTimersByTime(HOLD_MS)
    hold.onPointerUp()

    expect(onTap).toHaveBeenCalledTimes(1)
    expect(onHold).toHaveBeenCalledTimes(1)
  })

  it("does not let a stale press bleed into the next one", () => {
    const { hold, onTap, onHold } = harness()

    // Left mid-press, so the first gesture is over and its timer is gone.
    hold.onPointerDown(press())
    vi.advanceTimersByTime(HOLD_MS - 1)
    hold.onPointerLeave()

    hold.onPointerDown(press())
    vi.advanceTimersByTime(HOLD_MS - 1)
    hold.onPointerUp()

    expect(onTap).toHaveBeenCalledTimes(1)
    expect(onHold).not.toHaveBeenCalled()
  })
})

describe("a second pointer", () => {
  it("does not restart the clock under the one that started the press", () => {
    const { hold, onTap, onHold } = harness()

    hold.onPointerDown(press(1))
    vi.advanceTimersByTime(HOLD_MS - 1)
    hold.onPointerDown(press(2))
    vi.advanceTimersByTime(1)

    expect(onHold).toHaveBeenCalledTimes(1)
    expect(onTap).not.toHaveBeenCalled()
  })

  it("gets its turn once a cancelled pointer lets go of the control", () => {
    const { hold, onTap } = harness()

    // A touch the system took away, which delivers no release of its own. Touch pointer ids climb,
    // so a control that kept holding this one would turn every later press away for good.
    hold.onPointerDown(press(1))
    hold.onPointerCancel()

    hold.onPointerDown(press(2))
    vi.advanceTimersByTime(HOLD_MS - 1)
    hold.onPointerUp()

    expect(onTap).toHaveBeenCalledTimes(1)
  })
})
