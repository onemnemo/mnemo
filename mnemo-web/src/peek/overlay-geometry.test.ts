/**
 * The strip of canvas an overlay leaves is all or nothing, and the panel never becomes a
 * sliver, however wide the dock beside it is.
 */

import { describe, expect, it } from "vitest"

import { overlayGeometry } from "./overlay-geometry"
import { PEEK_CANVAS_STRIP, PEEK_MIN_WIDTH } from "./store"

describe("overlayGeometry", () => {
  it("keeps the stored width until the row is measured", () => {
    expect(overlayGeometry(0, 320, 600)).toEqual({ width: 600, inset: 320 })
  })

  it("leaves a strip of canvas showing when there is room for one", () => {
    expect(overlayGeometry(1000, 0, 600)).toEqual({ width: 600, inset: 0 })
    expect(overlayGeometry(500, 0, 600)).toEqual({ width: 500 - PEEK_CANVAS_STRIP, inset: 0 })
    expect(overlayGeometry(496, 0, 600)).toEqual({ width: PEEK_MIN_WIDTH, inset: 0 })
  })

  it("takes the whole canvas rather than leaving a ribbon of it", () => {
    expect(overlayGeometry(495, 0, 600)).toEqual({ width: 495, inset: 0 })
    expect(overlayGeometry(300, 0, 600)).toEqual({ width: 300, inset: 0 })
  })

  it("sits past an open dock while the canvas beside it can hold the panel", () => {
    expect(overlayGeometry(1200, 320, 600)).toEqual({ width: 600, inset: 320 })
    expect(overlayGeometry(1000, 320, 600)).toEqual({ width: 1000 - 320 - PEEK_CANVAS_STRIP, inset: 320 })
  })

  it("keeps its minimum over the dock rather than becoming a sliver beside it", () => {
    // 200px of canvas beside a 700px dock: the panel keeps 400 and covers 200 of the dock.
    expect(overlayGeometry(900, 700, 600)).toEqual({ width: PEEK_MIN_WIDTH, inset: 500 })
    // No canvas at all: the same, from the row's edge inward.
    expect(overlayGeometry(900, 900, 600)).toEqual({ width: PEEK_MIN_WIDTH, inset: 500 })
    // A row narrower than the minimum is taken whole, dock or not.
    expect(overlayGeometry(300, 250, 600)).toEqual({ width: 300, inset: 0 })
  })
})
