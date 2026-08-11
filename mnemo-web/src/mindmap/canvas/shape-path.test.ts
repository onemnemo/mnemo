import { describe, expect, it } from "vitest"

import { isOpenShape, shapePath, shapeTextInset } from "./shape-path"
import type { ShapeType } from "../model/document"

const ALL: readonly ShapeType[] = [
  "rectangle",
  "ellipse",
  "diamond",
  "hexagon",
  "parallelogram",
  "line",
  "arrow",
]

/** A wide, short box, which is the shape a measured label actually produces. */
const W = 160
const H = 80

interface Vertex {
  x: number
  y: number
}

/**
 * The points a `d` string actually visits.
 *
 * Reading every number out of the string would count an arc's radii and flags as coordinates and
 * pass a path that overhangs its box, so the commands are walked properly: only the last pair of an
 * arc is a point on the outline.
 */
function vertices(d: string): Vertex[] {
  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+/g) ?? []
  const out: Vertex[] = []
  let i = 0

  while (i < tokens.length) {
    const command = tokens[i]
    i += 1
    if (command === "Z") {
      continue
    }
    if (command === "A") {
      i += 5
    } else if (command !== "M" && command !== "L") {
      throw new Error(`unexpected command ${command} in ${d}`)
    }
    out.push({ x: Number(tokens[i]), y: Number(tokens[i + 1]) })
    i += 2
  }

  return out
}

describe("every shape", () => {
  for (const shape of ALL) {
    it(`${shape} is a path that starts at a point`, () => {
      const d = shapePath(shape, W, H)

      expect(d.length).toBeGreaterThan(0)
      expect(d.startsWith("M")).toBe(true)
      expect(d).not.toContain("NaN")
      expect(vertices(d).length).toBeGreaterThan(1)
    })

    it(`${shape} keeps every coordinate inside its own box`, () => {
      // A shape that overhangs its bounds is a shape whose selection outline and hit test both lie,
      // so this holds at every aspect ratio, not just the comfortable one.
      for (const [w, h] of [
        [W, H],
        [40, 40],
        [12, 90],
        [300, 24],
        [1, 1],
      ]) {
        for (const point of vertices(shapePath(shape, w, h))) {
          expect(point.x).toBeGreaterThanOrEqual(-0.001)
          expect(point.x).toBeLessThanOrEqual(w + 0.001)
          expect(point.y).toBeGreaterThanOrEqual(-0.001)
          expect(point.y).toBeLessThanOrEqual(h + 0.001)
        }
      }
    })

    it(`${shape} closes its path only when it encloses something`, () => {
      // An unclosed region fills to a straight line across its mouth, and a closed line draws a
      // return stroke back over itself.
      expect(shapePath(shape, W, H).endsWith("Z")).toBe(!isOpenShape(shape))
    })

    it(`${shape} survives a box dragged down to nothing`, () => {
      for (const [w, h] of [
        [0, 0],
        [-5, -5],
        [120, 0],
      ]) {
        expect(shapePath(shape, w, h)).not.toContain("NaN")
        const inset = shapeTextInset(shape, w, h)
        expect(Number.isFinite(inset.x)).toBe(true)
        expect(Number.isFinite(inset.y)).toBe(true)
      }
    })
  }
})

describe("open shapes", () => {
  it("are the line and the arrow and nothing else", () => {
    expect(ALL.filter(isOpenShape)).toEqual(["line", "arrow"])
  })

  it("share one shaft, since an arrow's head is a marker rather than geometry", () => {
    expect(shapePath("arrow", W, H)).toBe(shapePath("line", W, H))
  })

  it("run bottom left to top right, so a corner handle drags the end nearest it", () => {
    const [start, end] = vertices(shapePath("line", W, H))

    expect(start).toEqual({ x: 0, y: H })
    expect(end).toEqual({ x: W, y: 0 })
  })
})

describe("the text inset", () => {
  it("is nothing for a rectangle, whose outline is the box", () => {
    expect(shapeTextInset("rectangle", W, H)).toEqual({ x: 0, y: 0 })
  })

  it("is nothing for an open shape, which has no inside to sit in", () => {
    expect(shapeTextInset("line", W, H)).toEqual({ x: 0, y: 0 })
    expect(shapeTextInset("arrow", W, H)).toEqual({ x: 0, y: 0 })
  })

  it("is real on a diamond and on a hexagon", () => {
    for (const shape of ["diamond", "hexagon"] as const) {
      const inset = shapeTextInset(shape, W, H)
      expect(inset.x).toBeGreaterThan(0)
      expect(inset.y).toBeGreaterThan(0)
    }
  })

  it("costs a diamond a quarter of its box on every side", () => {
    // The diamond boundary is |x| + |y| = 1 normalised, so a centred rectangle can only be half the
    // box in each direction. This is the number that says a diamond has to be sized clear of its
    // text rather than measured tight around it.
    expect(shapeTextInset("diamond", W, H)).toEqual({ x: W / 4, y: H / 4 })
  })

  it("costs a diamond more than any other shape", () => {
    const diamond = shapeTextInset("diamond", W, H)

    for (const shape of ALL) {
      if (shape === "diamond") {
        continue
      }
      expect(shapeTextInset(shape, W, H).x).toBeLessThan(diamond.x)
    }
  })

  it("scales with the box", () => {
    for (const shape of ALL) {
      const small = shapeTextInset(shape, W, H)
      const large = shapeTextInset(shape, W * 2, H * 2)

      expect(large.x).toBeCloseTo(small.x * 2, 6)
      expect(large.y).toBeCloseTo(small.y * 2, 6)
    }
  })
})

describe("proportions taken off the height", () => {
  it("keeps the hexagon's bevel the same size however long the label is", () => {
    // A width fraction would flatten into a rectangle with clipped corners as the label grows, so the
    // same shape around one word and around six would not look like the same shape.
    expect(shapePath("hexagon", 400, H)).toBe("M40,0 L360,0 L400,40 L360,80 L40,80 L0,40 Z")
  })

  it("caps the bevel on a narrow box so the flat top cannot vanish", () => {
    expect(shapePath("hexagon", 80, 400)).toBe("M20,0 L60,0 L80,200 L60,400 L20,400 L0,200 Z")
  })

  it("caps the parallelogram's lean so a narrow box cannot fold through itself", () => {
    expect(shapePath("parallelogram", 30, 200)).toBe("M10,0 L30,0 L20,200 L0,200 Z")
  })
})

describe("the exact outlines", () => {
  // Pinned so that a change to any of this geometry is a change someone had to mean.
  const PINNED: Record<ShapeType, string> = {
    rectangle:
      "M10,0 L150,0 A10,10 0 0 1 160,10 L160,70 A10,10 0 0 1 150,80 L10,80 A10,10 0 0 1 0,70 L0,10 A10,10 0 0 1 10,0 Z",
    ellipse: "M0,40 A80,40 0 1 1 160,40 A80,40 0 1 1 0,40 Z",
    diamond: "M80,0 L160,40 L80,80 L0,40 Z",
    hexagon: "M40,0 L120,0 L160,40 L120,80 L40,80 L0,40 Z",
    parallelogram: "M28,0 L160,0 L132,80 L0,80 Z",
    line: "M0,80 L160,0",
    arrow: "M0,80 L160,0",
  }

  for (const shape of ALL) {
    it(`${shape} in a ${W} by ${H} box`, () => {
      expect(shapePath(shape, W, H)).toBe(PINNED[shape])
    })
  }

  it("rounds a rectangle's corners to match the card a node draws", () => {
    // The one absolute number in the file. A sharp cornered rectangle would be the only box on the
    // canvas reading as a different visual family from every node beside it.
    expect(shapePath("rectangle", W, H)).toContain("A10,10")
  })

  it("shrinks that radius rather than letting the arcs cross on a small box", () => {
    expect(shapePath("rectangle", 12, 12)).toContain("A6,6")
  })
})
