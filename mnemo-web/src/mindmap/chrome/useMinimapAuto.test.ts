// @vitest-environment jsdom

import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it } from "vitest"

import type { CanvasRuntime } from "../canvas/runtime"
import type { Scene, SceneElement } from "../model/scene"
import { offScreenAfter, useMinimapAuto } from "./useMinimapAuto"

// A map from (0, 0) to (1000, 500) in a 1000 x 500 pane.
const MAP = { minX: 0, minY: 0, maxX: 1000, maxY: 500 }
const PANE = { width: 1000, height: 500 }

describe("the Auto rule", () => {
  it("shows the map while part of it is past the camera", () => {
    expect(offScreenAfter(MAP, { x: 0, y: 0, zoom: 2 }, PANE, false)).toBe(true)
    expect(offScreenAfter(MAP, { x: 300, y: -50, zoom: 1 }, PANE, false)).toBe(true)
  })

  it("hides it when the whole map fits", () => {
    expect(offScreenAfter(MAP, { x: -100, y: -50, zoom: 0.8 }, PANE, true)).toBe(false)
  })

  it("hides it for an empty map", () => {
    expect(offScreenAfter(null, { x: 0, y: 0, zoom: 4 }, PANE, true)).toBe(false)
  })

  it("does not show until content is more than eight pixels off screen", () => {
    expect(offScreenAfter(MAP, { x: 8, y: 0, zoom: 1 }, PANE, false)).toBe(false)
    expect(offScreenAfter(MAP, { x: 9, y: 0, zoom: 1 }, PANE, false)).toBe(true)
  })

  it("does not hide until everything fits with eight pixels to spare", () => {
    expect(offScreenAfter(MAP, { x: -7, y: -20, zoom: 1 }, { width: 1014, height: 540 }, true)).toBe(true)
    expect(offScreenAfter(MAP, { x: -9, y: -20, zoom: 1 }, { width: 1018, height: 540 }, true)).toBe(false)
  })

  it("hides after a fit on a pane too small for eight pixels of spare", () => {
    // Fit leaves 2.5% a side: five pixels on a 200 pixel pane.
    const small = { width: 400, height: 200 }
    expect(offScreenAfter({ minX: 0, minY: 0, maxX: 380, maxY: 190 }, { x: -10, y: -5, zoom: 1 }, small, true)).toBe(false)
  })

  it("measures the tolerance in screen pixels, not map units", () => {
    // Four map units past the left edge is eight screen pixels at 2x, which is not yet past it.
    expect(offScreenAfter(MAP, { x: 4, y: 0, zoom: 2 }, { width: 2000, height: 1000 }, false)).toBe(false)
    expect(offScreenAfter(MAP, { x: 5, y: 0, zoom: 2 }, { width: 2000, height: 1000 }, false)).toBe(true)
  })
})

describe("the Auto hook", () => {
  it("answers nothing about an edit while the card is held, and answers again after", () => {
    const runtime = { current: { viewport: () => ({ x: 0, y: 0, zoom: 1 }) } as unknown as CanvasRuntime }
    const host = document.createElement("div")
    Object.defineProperties(host, { clientWidth: { value: 1000 }, clientHeight: { value: 500 } })
    const pane = { current: host }
    const held = { current: true }
    const box = { x: 0, y: 0, width: 3000, height: 100, rotation: 0 } as unknown as SceneElement
    const wide: Scene = { id: "m", elements: [box], edges: [], background: "dots" }
    const empty: Scene = { ...wide, elements: [] }

    let answer = false
    function Probe({ scene }: { scene: Scene }) {
      answer = useMinimapAuto(scene, runtime, pane, held).offScreen
      return null
    }
    const root = createRoot(document.createElement("div"))
    act(() => root.render(createElement(Probe, { scene: empty })))
    act(() => root.render(createElement(Probe, { scene: wide })))
    expect(answer).toBe(false)

    held.current = false
    act(() => root.render(createElement(Probe, { scene: { ...wide } })))
    expect(answer).toBe(true)
    act(() => root.unmount())
  })
})
