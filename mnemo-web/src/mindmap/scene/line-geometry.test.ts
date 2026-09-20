import { describe, expect, it } from "vitest"

import type { ShapeContent } from "../model/document"

import { shapePath } from "../canvas/shape-path"
import {
  absoluteLine,
  anchorPoint,
  chordDistance,
  extentOf,
  lengthAndAngle,
  LINE_PAD,
  lineBox,
  linePath,
  nearestAnchor,
  relative,
  resolveLine,
  sameLine,
  snapAngle,
  snapEnd,
} from "./line-geometry"

const BOX = { x: 100, y: 200, width: 120, height: 60 }
const none = () => undefined

describe("an older line row", () => {
  it("reads as the diagonal its box used to draw", () => {
    const line = resolveLine({ $type: "shape", shape: "line" }, BOX, none)

    expect(line.start).toEqual({ x: 0, y: 60 })
    expect(line.end).toEqual({ x: 120, y: 0 })
    expect(line.bend).toBeNull()
    expect(shapePath("line", 120, 60)).toBe(linePath(line.start, line.end, null))
  })

  it("wears the caps its shape implies and the outline weight", () => {
    const arrow = resolveLine({ $type: "shape", shape: "arrow" }, BOX, none)
    const line = resolveLine({ $type: "shape", shape: "line" }, BOX, none)

    expect([arrow.startCap, arrow.endCap]).toEqual(["none", "arrow"])
    expect([line.startCap, line.endCap]).toEqual(["none", "none"])
    expect(arrow.thickness).toBe(1.5)
  })
})

describe("a stored line", () => {
  const content: ShapeContent = {
    $type: "shape",
    shape: "arrow",
    line: { start: { x: 8, y: 8 }, end: { x: 112 }, bend: { x: 60, y: 40 } },
    startCap: "dot",
    endCap: "none",
    thickness: 4,
  }

  it("reads its sparse points with the zeros filled in", () => {
    const line = resolveLine(content, BOX, none)

    expect(line.end).toEqual({ x: 112, y: 0 })
    expect(line.bend).toEqual({ x: 60, y: 40 })
    expect([line.startCap, line.endCap, line.thickness]).toEqual(["dot", "none", 4])
  })

  it("draws a curve through its bend and a segment without one", () => {
    expect(linePath({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 5 })).toBe("M0,0 Q5,5 10,0")
    expect(linePath({ x: 0, y: 0 }, { x: 10, y: 0 }, null)).toBe("M0,0 L10,0")
  })
})

describe("an attached end", () => {
  const target = { id: "n", box: { x: 400, y: 100, width: 80, height: 40 } }
  const content: ShapeContent = {
    $type: "shape",
    shape: "arrow",
    line: { start: { x: 8, y: 8 }, end: { x: 112, y: 52 }, endAt: { elementId: "n", side: "left" } },
  }

  it("is drawn at its target's side, relative to the line's own box", () => {
    const line = resolveLine(content, BOX, (id) => (id === "n" ? target : undefined))

    expect(line.end).toEqual({ x: 300, y: -80 })
    expect(line.endAt).toEqual({ elementId: "n", side: "left" })
    expect(line.extent.maxX).toBeGreaterThan(400)
    expect(line.extent.minY).toBeLessThan(120)
  })

  it("stays at its stored point when the target cannot be found", () => {
    const line = resolveLine(content, BOX, none)

    expect(line.end).toEqual({ x: 112, y: 52 })
  })

  it("reads a missing side as the top", () => {
    const line = resolveLine(
      { ...content, line: { ...content.line, endAt: { elementId: "n" } } },
      BOX,
      () => target,
    )

    expect(line.end).toEqual({ x: 440 - 100, y: 100 - 200 })
  })
})

describe("anchors", () => {
  const box = { x: 0, y: 0, width: 100, height: 50 }

  it("sit at the middle of each side", () => {
    expect(anchorPoint(box, "top")).toEqual({ x: 50, y: 0 })
    expect(anchorPoint(box, "right")).toEqual({ x: 100, y: 25 })
    expect(anchorPoint(box, "bottom")).toEqual({ x: 50, y: 50 })
    expect(anchorPoint(box, "left")).toEqual({ x: 0, y: 25 })
  })

  it("turn with a rotated box about its centre", () => {
    const right = anchorPoint(box, "right", 90)

    expect(right.x).toBeCloseTo(50)
    expect(right.y).toBeCloseTo(75)
  })

  it("are found within a radius and not beyond it", () => {
    const targets = [{ id: "a", box }]

    expect(nearestAnchor(targets, { x: 104, y: 22 }, 10)).toMatchObject({ elementId: "a", side: "right" })
    expect(nearestAnchor(targets, { x: 120, y: 22 }, 10)).toBeNull()
  })

  it("pick the nearest side across every candidate", () => {
    const targets = [
      { id: "a", box },
      { id: "b", box: { x: 110, y: 0, width: 100, height: 50 } },
    ]

    expect(nearestAnchor(targets, { x: 107, y: 25 }, 20)).toMatchObject({ elementId: "b", side: "left" })
  })
})

describe("the stored box", () => {
  it("pads the points on every side so a flat line still has a box", () => {
    const box = lineBox([
      { x: 10, y: 20 },
      { x: 110, y: 20 },
    ])

    expect(box).toEqual({ x: 10 - LINE_PAD, y: 20 - LINE_PAD, width: 100 + 2 * LINE_PAD, height: 2 * LINE_PAD })
  })

  it("round trips a point through relative and absolute", () => {
    const line = resolveLine(
      { $type: "shape", shape: "line", line: { start: { x: 8, y: 8 }, end: { x: 40, y: 20 } } },
      BOX,
      none,
    )
    const abs = absoluteLine(line, BOX)

    expect(abs.start).toEqual({ x: 108, y: 208 })
    expect(relative(abs.end, BOX)).toEqual({ x: 40, y: 20 })
  })

  it("reaches further for a heavier stroke and a cap", () => {
    const plain = extentOf([{ x: 0, y: 0 }], 1.5, "none", "none")
    const capped = extentOf([{ x: 0, y: 0 }], 4, "none", "arrow")

    expect(capped.maxX).toBeGreaterThan(plain.maxX)
  })

  it("contains the full arrow marker at the maximum supported weight", () => {
    const capped = extentOf([{ x: 0, y: 0 }], 8, "arrow", "arrow")

    expect(capped.minX).toBeLessThanOrEqual(-39)
    expect(capped.maxX).toBeGreaterThanOrEqual(39)
  })
})

describe("angles", () => {
  it("read counter clockwise from due right, the way a protractor does", () => {
    expect(lengthAndAngle({ x: 0, y: 0 }, { x: 10, y: -10 })).toMatchObject({ angle: 45 })
    expect(lengthAndAngle({ x: 0, y: 0 }, { x: 0, y: 10 }).angle).toBe(270)
    expect(lengthAndAngle({ x: 0, y: 0 }, { x: 3, y: 4 }).length).toBe(5)
  })

  it("snap to the nearest step", () => {
    expect(snapAngle(53)).toBe(60)
    expect(snapAngle(-7)).toBe(0)
    expect(snapAngle(358)).toBe(0)
  })

  it("move an end onto the step without changing its distance", () => {
    const end = snapEnd({ x: 0, y: 0 }, { x: 100, y: -3 })

    expect(end.x).toBeCloseTo(Math.hypot(100, 3))
    expect(end.y).toBeCloseTo(0)
  })
})

describe("a bend", () => {
  it("measures its distance from the chord, capped at the ends", () => {
    expect(chordDistance({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(3)
    expect(chordDistance({ x: 14, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5)
  })
})

describe("two geometries", () => {
  const a = { start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, bend: null, startAt: null, endAt: null }

  it("are the same when nothing that would be stored differs", () => {
    expect(sameLine(a, { ...a, end: { x: 10.2, y: 0.1 } })).toBe(true)
    expect(sameLine(a, { ...a, endAt: { elementId: "n" } })).toBe(false)
    expect(sameLine({ ...a, endAt: { elementId: "n" } }, { ...a, endAt: { elementId: "n", side: "top" } })).toBe(true)
    expect(sameLine(a, { ...a, bend: { x: 5, y: 5 } })).toBe(false)
  })
})
