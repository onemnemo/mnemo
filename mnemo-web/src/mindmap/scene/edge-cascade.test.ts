import { describe, expect, it } from "vitest"

import type { StyleTemplate } from "../model/document"

import { resolveEdgeStyle, ribbonWidths } from "./edge-cascade"

const orthogonal: StyleTemplate = {
  id: "org",
  name: "Org",
  edgeDefaults: { routing: "orthogonal", line: "solid" },
}

describe("what an edge is made of", () => {
  it("takes the edge's own style first", () => {
    const style = resolveEdgeStyle({ routing: "straight" }, "hierarchy", { routing: "curve" }, [orthogonal])

    expect(style.routing).toBe("straight")
  })

  it("lets the map's own defaults beat a template's", () => {
    // The point of the canvas layer. Picking a branch style from the toolbar has to stick even on the
    // templates that state one, or the control silently fails on exactly the maps that care.
    const style = resolveEdgeStyle(null, "hierarchy", { routing: "curve" }, [orthogonal])

    expect(style.routing).toBe("curve")
  })

  it("falls to the template when the map named nothing", () => {
    expect(resolveEdgeStyle(null, "hierarchy", null, [orthogonal]).routing).toBe("orthogonal")
  })

  it("resolves each property on its own, not the winning layer wholesale", () => {
    const style = resolveEdgeStyle({ line: "dotted" }, "hierarchy", null, [orthogonal])

    expect(style.line).toBe("dotted")
    expect(style.routing).toBe("orthogonal")
  })
})

describe("what a kind means", () => {
  it("draws a branch as a plain solid curve that points nowhere", () => {
    expect(resolveEdgeStyle(null, "hierarchy", null)).toMatchObject({
      line: "solid",
      routing: "curve",
      startCap: "none",
      endCap: "none",
      widthProfile: "uniform",
    })
  })

  it("draws a cross-link dashed and pointing, because it is a remark and not structure", () => {
    expect(resolveEdgeStyle(null, "link", null)).toMatchObject({ line: "dashed", endCap: "arrow" })
  })

  it("lets anything above override what the kind means", () => {
    expect(resolveEdgeStyle({ endCap: "none" }, "link", null).endCap).toBe("none")
    expect(resolveEdgeStyle(null, "link", { line: "solid" }).line).toBe("solid")
  })

  it("leaves colour and thickness unclaimed, so the renderer's own material stands", () => {
    const style = resolveEdgeStyle(null, "hierarchy", null)

    expect(style.color).toBeNull()
    expect(style.thickness).toBeNull()
  })
})

describe("ribbon widths", () => {
  it("are thick at the trunk and thin at the twig", () => {
    const w = ribbonWidths(0, 1, null)

    expect(w.fromWidth).toBeGreaterThan(w.toWidth)
  })

  it("stop thinning past the table, so a deep map does not dissolve", () => {
    expect(ribbonWidths(9, 12, null)).toEqual(ribbonWidths(4, 4, null))
  })

  it("let an explicit thickness name the trunk end and keep the taper", () => {
    // Scaling rather than replacing: a thickness control that did nothing on the one edge style
    // people reach for it on is a control that looks broken.
    const plain = ribbonWidths(0, 2, null)
    const thick = ribbonWidths(0, 2, plain.fromWidth * 2)

    expect(thick.fromWidth).toBeCloseTo(plain.fromWidth * 2, 6)
    expect(thick.toWidth).toBeCloseTo(plain.toWidth * 2, 6)
  })
})
