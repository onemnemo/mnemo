import { describe, expect, it } from "vitest"

import {
  badgeVisible,
  centerOfMasks,
  clampView,
  fitSize,
  FIT_VIEW,
  glyphSize,
  panBy,
  polygonPoints,
  viewFrame,
  zoomAt,
  zoomOnto,
} from "./geometry"

const IMAGE = { w: 1000, h: 680 }

describe("fitSize", () => {
  it("contains the image in the room by the tighter axis", () => {
    expect(fitSize(IMAGE, { w: 656, h: 403 })).toEqual({ w: 593, h: 403 })
    expect(fitSize(IMAGE, { w: 300, h: 403 })).toEqual({ w: 300, h: 204 })
  })

  it("gives nothing for an unmeasured image or room", () => {
    expect(fitSize({ w: 0, h: 0 }, { w: 656, h: 403 })).toEqual({ w: 0, h: 0 })
    expect(fitSize(IMAGE, { w: 0, h: 403 })).toEqual({ w: 0, h: 0 })
  })
})

describe("viewFrame", () => {
  const box = { w: 656, h: 403 }
  const fitted = { w: 593, h: 403 }

  it("centres the fitted image in the box", () => {
    expect(viewFrame(FIT_VIEW, box, fitted)).toEqual({ x: 32, y: 0, w: 593, h: 403 })
  })

  it("centres on a point and clamps to the image edge", () => {
    // The small plant cell mask sits near the left edge, so the zoomed image cannot slide right.
    const mask = { x: 0.03, y: 0.4882, w: 0.2, h: 0.0529 }
    const view = zoomOnto(2, centerOfMasks([mask]), box, fitted)
    const frame = viewFrame(view, box, fitted)
    expect(frame.w).toBe(1186)
    expect(frame.h).toBe(806)
    expect(frame.x).toBe(0)
    expect(frame.y).toBe(-213)
  })

  it("never shows past the far edges", () => {
    const corner = { x: 0.95, y: 0.95, w: 0.05, h: 0.05 }
    const frame = viewFrame(zoomOnto(2, centerOfMasks([corner]), box, fitted), box, fitted)
    expect(frame.x).toBe(box.w - frame.w)
    expect(frame.y).toBe(box.h - frame.h)
  })

  it("keeps an image that still fits one axis centred on that axis", () => {
    const tall = { w: 200, h: 403 }
    const frame = viewFrame({ scale: 2, cx: 0.9, cy: 0.5 }, box, tall)
    expect(frame.w).toBe(400)
    expect(frame.x).toBe(128)
  })
})

describe("centerOfMasks", () => {
  it("is the centre of the box around every member of a group", () => {
    const a = { x: 0.1, y: 0.1, w: 0.1, h: 0.1 }
    const b = { x: 0.5, y: 0.7, w: 0.1, h: 0.1 }
    const { cx, cy } = centerOfMasks([a, b])
    expect(cx).toBeCloseTo(0.35)
    expect(cy).toBeCloseTo(0.45)
  })

  it("falls back to the middle of the image", () => {
    expect(centerOfMasks([])).toEqual({ cx: 0.5, cy: 0.5 })
  })
})

describe("zoomAt and panBy", () => {
  const box = { w: 656, h: 403 }
  const fitted = { w: 593, h: 403 }

  it("keeps the image point under the pointer fixed while zooming", () => {
    const anchor = { x: 300, y: 200 }
    const before = viewFrame(FIT_VIEW, box, fitted)
    const view = zoomAt(FIT_VIEW, 2, anchor, box, fitted)
    const after = viewFrame(view, box, fitted)

    const u = (anchor.x - before.x) / before.w
    expect(after.x + u * after.w).toBeCloseTo(anchor.x, 0)
    expect(after.w).toBe(1186)
  })

  it("stops at the limits of the zoom range", () => {
    let view = FIT_VIEW
    for (let i = 0; i < 10; i++) view = zoomAt(view, 2, { x: 100, y: 100 }, box, fitted)
    expect(view.scale).toBe(4)
    for (let i = 0; i < 10; i++) view = zoomAt(view, 0.5, { x: 100, y: 100 }, box, fitted)
    expect(view.scale).toBe(1)
  })

  it("pans by the pointer delta and cannot leave the image", () => {
    const zoomed = zoomOnto(2, { cx: 0.5, cy: 0.5 }, box, fitted)
    const start = viewFrame(zoomed, box, fitted)
    const moved = viewFrame(panBy(zoomed, 40, 0, box, fitted), box, fitted)
    expect(moved.x - start.x).toBe(40)

    const far = viewFrame(panBy(zoomed, 5000, -5000, box, fitted), box, fitted)
    expect(far.x).toBe(0)
    expect(far.y).toBe(box.h - far.h)
  })

  it("clampView pulls an out of range scale back", () => {
    expect(clampView({ scale: 9, cx: 0.5, cy: 0.5 }, box, fitted).scale).toBe(4)
    expect(clampView({ scale: 0.2, cx: 0.5, cy: 0.5 }, box, fitted).scale).toBe(1)
  })
})

describe("polygonPoints", () => {
  it("writes image fractions as an SVG points value", () => {
    expect(
      polygonPoints([
        [0.1, 0.2],
        [0.5, 0.25],
        [0.3, 0.9],
      ]),
    ).toBe("0.1,0.2 0.5,0.25 0.3,0.9")
  })
})

describe("glyphSize", () => {
  it("is 0.6 of the mask height between 9 and 19 pixels", () => {
    expect(glyphSize(10)).toBe(9)
    expect(glyphSize(30)).toBe(18)
    expect(glyphSize(200)).toBe(19)
  })
})

describe("badgeVisible", () => {
  const base = { maskCount: 10, maskHeightPx: 40, selected: false, grouped: false, hovered: false, zoom: 1 }

  it("shows every badge on a sparse image", () => {
    expect(badgeVisible(base)).toBe(true)
  })

  it("hides a badge on a mask shorter than 20 pixels whatever else is true", () => {
    expect(badgeVisible({ ...base, maskHeightPx: 19, selected: true })).toBe(false)
    expect(badgeVisible({ ...base, maskHeightPx: 20 })).toBe(true)
  })

  it("limits a dense image to selected, grouped and hovered masks", () => {
    const dense = { ...base, maskCount: 16 }
    expect(badgeVisible(dense)).toBe(false)
    expect(badgeVisible({ ...dense, selected: true })).toBe(true)
    expect(badgeVisible({ ...dense, grouped: true })).toBe(true)
    expect(badgeVisible({ ...dense, hovered: true })).toBe(true)
  })

  it("shows every badge on a dense image once zoom is 200% of fit", () => {
    const dense = { ...base, maskCount: 48 }
    expect(badgeVisible({ ...dense, zoom: 1.9 })).toBe(false)
    expect(badgeVisible({ ...dense, zoom: 2 })).toBe(true)
  })

  it("treats fifteen masks as sparse", () => {
    expect(badgeVisible({ ...base, maskCount: 15 })).toBe(true)
  })
})
