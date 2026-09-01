/**
 * The crop math, pinned.
 *
 * Everything a stored crop promises rests on these functions agreeing with each other: the stage
 * drags with `panBy`, the slider zooms with `zoomAt`, the value saved is `toCrop`, and reopening
 * it is `fromCrop`. A drift between any two of them shows up as a picture that moves when nobody
 * touched it, which is exactly the failure a crop is meant to make impossible.
 */

import { describe, expect, it } from "vitest"

import {
  FIT,
  ZOOM_MAX,
  clamp,
  fitCropToContainer,
  fromCrop,
  isWholeCrop,
  panBy,
  scaled,
  toCrop,
  wholeCrop,
  zoomAt,
  type Frame,
  type ImageCrop,
  type View,
} from "./geometry"

/** A landscape source under a square frame: width overhangs, height binds at zoom 1. */
const WIDE: Frame = { fw: 200, fh: 200, ratio: 2 }

/** A portrait source under a square frame: height overhangs. */
const TALL: Frame = { fw: 200, fh: 200, ratio: 0.5 }

/** A source and a frame of the same shape: no overhang at all at zoom 1. */
const EXACT: Frame = { fw: 300, fh: 150, ratio: 2 }

function near(actual: number, expected: number, tolerance = 1e-9): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance)
}

function viewNear(actual: View, expected: View, tolerance = 1e-9): void {
  near(actual.zoom, expected.zoom, tolerance)
  near(actual.ox, expected.ox, tolerance)
  near(actual.oy, expected.oy, tolerance)
}

describe("clamp", () => {
  it("holds a value inside the range", () => {
    expect(clamp(5, 0, 1)).toBe(1)
    expect(clamp(-5, 0, 1)).toBe(0)
    expect(clamp(0.25, 0, 1)).toBe(0.25)
  })
})

describe("scaled", () => {
  it("binds on the height when the source is wider than the frame", () => {
    expect(scaled(WIDE, 1)).toEqual({ sw: 400, sh: 200 })
  })

  it("binds on the width when the source is taller than the frame", () => {
    expect(scaled(TALL, 1)).toEqual({ sw: 200, sh: 400 })
  })

  it("covers exactly when the shapes match", () => {
    expect(scaled(EXACT, 1)).toEqual({ sw: 300, sh: 150 })
  })

  it("multiplies both edges by the zoom", () => {
    expect(scaled(WIDE, 2)).toEqual({ sw: 800, sh: 400 })
  })
})

describe("panBy", () => {
  it("moves the picture with the drag, as a fraction of the overhang", () => {
    // 200px of overhang on the width, so dragging 20px right moves the pan a tenth back.
    const next = panBy(FIT, 20, 0, WIDE)
    near(next.ox, 0.4)
    expect(next.oy).toBe(0.5)
  })

  it("pins an axis with no overhang to the centre", () => {
    const next = panBy({ zoom: 1, ox: 0.2, oy: 0.9 }, 50, 50, EXACT)
    expect(next).toEqual({ zoom: 1, ox: 0.5, oy: 0.5 })
  })

  it("clamps at both ends rather than showing empty ground", () => {
    expect(panBy(FIT, 5000, 0, WIDE).ox).toBe(0)
    expect(panBy(FIT, -5000, 0, WIDE).ox).toBe(1)
    expect(panBy(FIT, 0, 5000, TALL).oy).toBe(0)
    expect(panBy(FIT, 0, -5000, TALL).oy).toBe(1)
  })

  it("leaves the zoom alone", () => {
    expect(panBy({ zoom: 2.5, ox: 0.5, oy: 0.5 }, 10, 10, WIDE).zoom).toBe(2.5)
  })
})

describe("zoomAt", () => {
  it("holds the anchored point still", () => {
    const frame = WIDE
    const anchor = { cx: 40, cy: 160 }
    const before: View = { zoom: 1.5, ox: 0.3, oy: 0.7 }

    const sourcePointUnder = (view: View) => {
      const { sw, sh } = scaled(frame, view.zoom)
      return {
        u: (view.ox * (sw - frame.fw) + anchor.cx) / sw,
        v: (view.oy * (sh - frame.fh) + anchor.cy) / sh,
      }
    }

    const after = zoomAt(before, 2.4, anchor.cx, anchor.cy, frame)
    const from = sourcePointUnder(before)
    const to = sourcePointUnder(after)

    near(to.u, from.u, 1e-12)
    near(to.v, from.v, 1e-12)
  })

  it("clamps the zoom to the allowed range", () => {
    expect(zoomAt(FIT, 0.2, 100, 100, WIDE).zoom).toBe(1)
    expect(zoomAt(FIT, 40, 100, 100, WIDE).zoom).toBe(ZOOM_MAX)
  })

  it("recentres an axis that loses its overhang on the way back to fit", () => {
    const zoomedOut = zoomAt({ zoom: 3, ox: 0.1, oy: 0.9 }, 1, 100, 100, EXACT)
    expect(zoomedOut).toEqual(FIT)
  })

  it("keeps the axis that still overhangs at zoom 1", () => {
    const zoomedOut = zoomAt({ zoom: 3, ox: 0.1, oy: 0.9 }, 1, 100, 100, WIDE)
    expect(zoomedOut.zoom).toBe(1)
    expect(zoomedOut.oy).toBe(0.5)
    expect(zoomedOut.ox).toBeGreaterThanOrEqual(0)
    expect(zoomedOut.ox).toBeLessThanOrEqual(1)
  })

  it("anchors at the frame centre the way the slider and the keys call it", () => {
    const centred = zoomAt(FIT, 2, WIDE.fw / 2, WIDE.fh / 2, WIDE)
    expect(centred).toEqual({ zoom: 2, ox: 0.5, oy: 0.5 })
  })
})

describe("toCrop", () => {
  it("reports the frame's shape as the aspect", () => {
    expect(toCrop(FIT, EXACT).aspect).toBe(2)
    expect(toCrop(FIT, WIDE).aspect).toBe(1)
  })

  it("leaves the binding edge whole at zoom 1", () => {
    const wide = toCrop(FIT, WIDE)
    expect(wide.h).toBe(1)
    near(wide.w, 0.5)
    near(wide.x, 0.25)
    expect(wide.y).toBe(0)

    const tall = toCrop(FIT, TALL)
    expect(tall.w).toBe(1)
    near(tall.h, 0.5)
  })

  it("takes the whole picture when the shapes match", () => {
    expect(toCrop(FIT, EXACT)).toEqual({ x: 0, y: 0, w: 1, h: 1, aspect: 2 })
  })

  it("shrinks the window as the zoom grows", () => {
    const zoomed = toCrop({ zoom: 2, ox: 0.5, oy: 0.5 }, WIDE)
    near(zoomed.w, 0.25)
    near(zoomed.h, 0.5)
    near(zoomed.x, 0.375)
    near(zoomed.y, 0.25)
  })

  it("puts the window at the edge the pan asked for", () => {
    const left = toCrop({ zoom: 1, ox: 0, oy: 0.5 }, WIDE)
    expect(left.x).toBe(0)
    const right = toCrop({ zoom: 1, ox: 1, oy: 0.5 }, WIDE)
    near(right.x, 0.5)
  })

  it("never reports a window larger than the source", () => {
    for (const zoom of [1, 1.0001, 2, ZOOM_MAX]) {
      for (const frame of [WIDE, TALL, EXACT]) {
        const crop = toCrop({ zoom, ox: 0.5, oy: 0.5 }, frame)
        expect(crop.w).toBeLessThanOrEqual(1)
        expect(crop.h).toBeLessThanOrEqual(1)
        expect(crop.w).toBeGreaterThan(0)
        expect(crop.h).toBeGreaterThan(0)
      }
    }
  })
})

describe("fromCrop", () => {
  it("reads the zoom back off the larger edge", () => {
    near(fromCrop({ x: 0, y: 0, w: 0.5, h: 1, aspect: 1 }).zoom, 1)
    near(fromCrop({ x: 0, y: 0, w: 0.25, h: 0.5, aspect: 1 }).zoom, 2)
  })

  it("centres an axis the window fills whole", () => {
    const view = fromCrop({ x: 0, y: 0, w: 0.5, h: 1, aspect: 1 })
    expect(view.oy).toBe(0.5)
  })

  it("clamps a zoom the stored value could not have produced", () => {
    expect(fromCrop({ x: 0, y: 0, w: 0.001, h: 0.001, aspect: 1 }).zoom).toBe(ZOOM_MAX)
    expect(fromCrop({ x: 0, y: 0, w: 2, h: 2, aspect: 1 }).zoom).toBe(1)
  })

  it("restores the whole picture as fit", () => {
    expect(fromCrop(wholeCrop(1.6))).toEqual(FIT)
  })
})

describe("view to crop and back", () => {
  const frames = [WIDE, TALL, EXACT, { fw: 420, fh: 140, ratio: 0.8 }]
  const views: View[] = [
    FIT,
    { zoom: 1.75, ox: 0, oy: 0 },
    { zoom: 1.75, ox: 1, oy: 1 },
    { zoom: 2.5, ox: 0.2, oy: 0.85 },
    { zoom: ZOOM_MAX, ox: 0.5, oy: 0.5 },
  ]

  for (const frame of frames) {
    for (const view of views) {
      it(`round trips ${JSON.stringify(view)} under ${JSON.stringify(frame)}`, () => {
        // Only views the stage can actually reach: an axis with no overhang is pinned centre by
        // panBy and zoomAt, and a crop cannot carry a pan the frame does not have room for.
        const reachable = panBy(view, 0, 0, frame)
        viewNear(fromCrop(toCrop(reachable, frame)), reachable, 1e-9)
      })
    }
  }

  it("keeps the aspect a crop was cut for", () => {
    for (const frame of frames) {
      near(toCrop(FIT, frame).aspect, frame.fw / frame.fh)
    }
  })
})

describe("isWholeCrop", () => {
  it("is true for the crop toCrop produces when the frame matches the source", () => {
    expect(isWholeCrop(toCrop(FIT, EXACT))).toBe(true)
  })

  it("is true for wholeCrop itself", () => {
    expect(isWholeCrop(wholeCrop(1.6))).toBe(true)
  })

  it("is false once either edge has shrunk", () => {
    expect(isWholeCrop(toCrop(FIT, WIDE))).toBe(false)
    expect(isWholeCrop(toCrop(FIT, TALL))).toBe(false)
    expect(isWholeCrop({ x: 0, y: 0, w: 1, h: 0.999999, aspect: 1 })).toBe(false)
  })
})

describe("fitCropToContainer", () => {
  const natural = { width: 400, height: 200 }

  it("covers a container narrower than the crop window", () => {
    // A square window out of a 2:1 source, into a 3:1 container: the width binds.
    const crop: ImageCrop = { x: 0.25, y: 0, w: 0.5, h: 1, aspect: 1 }
    expect(fitCropToContainer(crop, { width: 300, height: 100 }, natural)).toEqual({
      width: 600,
      height: 300,
      left: -150,
      top: -100,
    })
  })

  it("covers a container taller than the crop window", () => {
    const crop: ImageCrop = { x: 0.25, y: 0, w: 0.5, h: 1, aspect: 1 }
    expect(fitCropToContainer(crop, { width: 100, height: 300 }, natural)).toEqual({
      width: 600,
      height: 300,
      left: -250,
      top: 0,
    })
  })

  it("centres the window it was given, not the picture", () => {
    const crop: ImageCrop = { x: 0.1, y: 0.2, w: 0.4, h: 0.2, aspect: 2 }
    expect(fitCropToContainer(crop, { width: 600, height: 200 }, { width: 1000, height: 1000 })).toEqual({
      width: 1500,
      height: 1500,
      left: -150,
      top: -350,
    })
  })

  it("falls back to plain cover for an uncropped source", () => {
    // Which is what object-fit: cover with a centred position would have produced.
    expect(fitCropToContainer(wholeCrop(2), { width: 100, height: 100 }, natural)).toEqual({
      width: 200,
      height: 100,
      left: -50,
      top: 0,
    })
  })

  it("lays the window edge to edge when the shapes already agree", () => {
    const crop: ImageCrop = { x: 0.25, y: 0, w: 0.5, h: 1, aspect: 1 }
    expect(fitCropToContainer(crop, { width: 200, height: 200 }, natural)).toEqual({
      width: 400,
      height: 200,
      left: -100,
      top: 0,
    })
  })

  it("takes the window's real shape from the natural size, not from the stored aspect", () => {
    // A stored aspect that disagrees with the pixels (a source swapped for a differently shaped
    // file) must not stretch the picture, so the natural size wins.
    const crop: ImageCrop = { x: 0, y: 0, w: 1, h: 1, aspect: 1 }
    const layout = fitCropToContainer(crop, { width: 100, height: 100 }, natural)
    near(layout.width / layout.height, 2)
  })

  it("uses the stored aspect when the natural size is not known yet", () => {
    const crop: ImageCrop = { x: 0, y: 0, w: 1, h: 1, aspect: 2 }
    const layout = fitCropToContainer(crop, { width: 100, height: 100 }, { width: 0, height: 0 })
    near(layout.width / layout.height, 2)
  })

  it("answers zero for a container that has not been measured", () => {
    const crop = wholeCrop(2)
    expect(fitCropToContainer(crop, { width: 0, height: 120 }, natural)).toEqual({
      width: 0,
      height: 0,
      left: 0,
      top: 0,
    })
    expect(fitCropToContainer(crop, { width: 120, height: 0 }, natural)).toEqual({
      width: 0,
      height: 0,
      left: 0,
      top: 0,
    })
  })

  it("survives a degenerate window without dividing by zero", () => {
    const crop: ImageCrop = { x: 0, y: 0, w: 0, h: 0, aspect: 1 }
    const layout = fitCropToContainer(crop, { width: 100, height: 100 }, natural)
    expect(Number.isFinite(layout.width)).toBe(true)
    expect(Number.isFinite(layout.height)).toBe(true)
    expect(Number.isFinite(layout.left)).toBe(true)
    expect(Number.isFinite(layout.top)).toBe(true)
  })

  it("always covers the container it was handed", () => {
    const crops: ImageCrop[] = [
      wholeCrop(2),
      { x: 0.25, y: 0, w: 0.5, h: 1, aspect: 1 },
      { x: 0.1, y: 0.1, w: 0.3, h: 0.6, aspect: 1 },
      { x: 0, y: 0.4, w: 1, h: 0.25, aspect: 8 },
    ]
    const containers = [
      { width: 300, height: 70 },
      { width: 900, height: 70 },
      { width: 120, height: 400 },
      { width: 200, height: 200 },
    ]

    for (const crop of crops) {
      for (const container of containers) {
        const layout = fitCropToContainer(crop, container, natural)
        const windowW = layout.width * crop.w
        const windowH = layout.height * crop.h
        expect(windowW).toBeGreaterThanOrEqual(container.width - 1e-9)
        expect(windowH).toBeGreaterThanOrEqual(container.height - 1e-9)

        // And the window stays centred on the container, which is what stops a wider pane
        // sliding the subject out of view.
        const windowLeft = layout.left + crop.x * layout.width
        const windowTop = layout.top + crop.y * layout.height
        near(windowLeft + windowW / 2, container.width / 2, 1e-9)
        near(windowTop + windowH / 2, container.height / 2, 1e-9)
      }
    }
  })
})
