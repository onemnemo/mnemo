// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { MOTION_IDLE, MotionHint } from "./motion"

function host(): HTMLElement {
  return document.createElement("div")
}

describe("MotionHint", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("promotes on the first frame of a gesture", () => {
    const world = host()
    const hint = new MotionHint(world)

    expect(world.hasAttribute("data-mm-motion")).toBe(false)
    hint.moved()
    expect(world.hasAttribute("data-mm-motion")).toBe(true)
    expect(hint.active()).toBe(true)
  })

  it("drops the hint once the map has been still, so everything re-rasters at the settled zoom", () => {
    const world = host()
    const hint = new MotionHint(world)

    hint.moved()
    vi.advanceTimersByTime(MOTION_IDLE - 1)
    expect(world.hasAttribute("data-mm-motion")).toBe(true)

    vi.advanceTimersByTime(1)
    expect(world.hasAttribute("data-mm-motion")).toBe(false)
    expect(hint.active()).toBe(false)
  })

  it("stays on across a run of frames, so a pan is one promotion rather than one per frame", () => {
    const world = host()
    const hint = new MotionHint(world)
    const writes = new MutationObserver(() => {})
    writes.observe(world, { attributes: true, attributeFilter: ["data-mm-motion"] })

    for (let frame = 0; frame < 60; frame += 1) {
      hint.moved()
      vi.advanceTimersByTime(16)
    }

    expect(world.hasAttribute("data-mm-motion")).toBe(true)
    expect(writes.takeRecords()).toHaveLength(1)
    writes.disconnect()
  })

  it("holds through the gap between two wheel notches", () => {
    const world = host()
    const hint = new MotionHint(world)

    hint.moved()
    vi.advanceTimersByTime(MOTION_IDLE - 20)
    hint.moved()
    vi.advanceTimersByTime(MOTION_IDLE - 20)

    expect(world.hasAttribute("data-mm-motion")).toBe(true)
  })

  it("leaves nothing behind when the runtime goes away mid-gesture", () => {
    const world = host()
    const hint = new MotionHint(world)

    hint.moved()
    hint.dispose()

    expect(world.hasAttribute("data-mm-motion")).toBe(false)
    expect(hint.active()).toBe(false)

    // The pending timer must be gone too, or it fires against a torn-down runtime.
    vi.advanceTimersByTime(MOTION_IDLE * 4)
    expect(world.hasAttribute("data-mm-motion")).toBe(false)
  })

  it("takes a shorter idle when one is asked for", () => {
    const world = host()
    const hint = new MotionHint(world, 40)

    hint.moved()
    vi.advanceTimersByTime(40)

    expect(world.hasAttribute("data-mm-motion")).toBe(false)
  })
})
