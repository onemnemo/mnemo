import { describe, expect, it } from "vitest"

import type { SceneEdge } from "../model/scene"
import { drawingFor, drawingPathData } from "./edge-drawing"
import { highlightGeometry } from "./edge-highlight"
import { anchorsFor, edgeGeometry, type ElementBox } from "./edge-paths"

const SOURCE: ElementBox = { x: 0, y: 0, width: 100, height: 40 }
const TARGET: ElementBox = { x: 300, y: 160, width: 100, height: 40 }
const boxes = new Map([
  ["s", SOURCE],
  ["t", TARGET],
])

function edge(extra: Partial<SceneEdge> = {}): SceneEdge {
  return { id: "e", fromId: "s", toId: "t", kind: "link", thickness: 5, ...extra }
}

describe("highlightGeometry", () => {
  for (const routing of ["curve", "straight", "orthogonal"] as const) {
    it(`traces a ${routing} arrow line as drawn, not the line it was trimmed from`, () => {
      const input = edge({ routing, startCap: "arrow", endCap: "arrow" })
      const highlight = highlightGeometry(input, (id) => boxes.get(id))!

      expect(highlight.path).toBe(drawingPathData(drawingFor(input, anchorsFor(SOURCE, TARGET)).stroke))
    })
  }

  it("keeps its end handles on the anchors, where the tips are", () => {
    const highlight = highlightGeometry(edge({ endCap: "arrow" }), (id) => boxes.get(id))!
    const anchors = anchorsFor(SOURCE, TARGET)

    expect(highlight.end).toEqual({ x: anchors.tx, y: anchors.ty })
    expect(highlight.start).toEqual({ x: anchors.sx, y: anchors.sy })
  })

  it("traces the whole of a tapered branch, which takes no caps, even when an arrow is asked for", () => {
    const plain = highlightGeometry(edge({ fromWidth: 7, toWidth: 2 }), (id) => boxes.get(id))!
    const capped = highlightGeometry(edge({ fromWidth: 7, toWidth: 2, endCap: "arrow" }), (id) => boxes.get(id))!

    expect(capped.path).toBe(plain.path)
    expect(capped.path).toBe(edgeGeometry("curve", anchorsFor(SOURCE, TARGET)).path)
  })

  it("traces an uncapped line end to end", () => {
    const highlight = highlightGeometry(edge(), (id) => boxes.get(id))!

    expect(highlight.path).toBe(edgeGeometry("curve", anchorsFor(SOURCE, TARGET)).path)
  })

  it("traces the centre of a double line rather than one of its rails", () => {
    const highlight = highlightGeometry(edge({ lineStyle: "double", endCap: "arrow" }), (id) => boxes.get(id))!

    expect(highlight.path).toBe(drawingPathData(drawingFor(edge({ endCap: "arrow" }), anchorsFor(SOURCE, TARGET)).stroke))
  })
})
