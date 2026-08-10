import { describe, expect, it } from "vitest"

import { applyDelta, isEmptyDelta } from "./delta"
import type { MindmapDocument, MindmapEdge, MindmapElement } from "./document"

function node(id: string, text = id): MindmapElement {
  return { id, kind: "node", content: { $type: "text", text } }
}

function edge(id: string, fromId: string, toId: string): MindmapEdge {
  return { id, fromId, toId, kind: "hierarchy" }
}

const base: MindmapDocument = {
  id: "m",
  revision: 4,
  elements: [node("a"), node("b"), node("c")],
  edges: [edge("e1", "a", "b"), edge("e2", "a", "c")],
}

describe("applying a delta", () => {
  it("upserts a changed element in place rather than moving it to the end", () => {
    const next = applyDelta(base, { elements: [node("b", "renamed")] }, 5)

    expect(next.elements!.map((e) => e.id)).toEqual(["a", "b", "c"])
    expect(next.elements![1].content).toEqual({ $type: "text", text: "renamed" })
    expect(next.revision).toBe(5)
  })

  it("appends elements it has never seen", () => {
    const next = applyDelta(base, { elements: [node("d")] }, 5)

    expect(next.elements!.map((e) => e.id)).toEqual(["a", "b", "c", "d"])
  })

  it("drops removed ids from both arrays", () => {
    const next = applyDelta(base, { removeElementIds: ["b"], removeEdgeIds: ["e1"] }, 5)

    expect(next.elements!.map((e) => e.id)).toEqual(["a", "c"])
    expect(next.edges!.map((e) => e.id)).toEqual(["e2"])
  })

  it("leaves the original document untouched", () => {
    applyDelta(base, { elements: [node("b", "renamed")], removeElementIds: ["c"] }, 5)

    expect(base.elements!.map((e) => e.id)).toEqual(["a", "b", "c"])
    expect(base.elements![1].content).toEqual({ $type: "text", text: "b" })
  })

  it("puts an inserted sibling where the order says, not last", () => {
    // The case the order companion exists for: the server inserted e3 between the two existing
    // hierarchy edges, and sibling order IS that array's order. Folding the delta alone appends.
    const next = applyDelta(
      base,
      { elements: [node("d")], edges: [edge("e3", "a", "d")] },
      5,
      { elements: ["a", "b", "d", "c"], edges: ["e1", "e3", "e2"] },
    )

    expect(next.edges!.map((e) => e.id)).toEqual(["e1", "e3", "e2"])
    expect(next.elements!.map((e) => e.id)).toEqual(["a", "b", "d", "c"])
  })

  it("keeps an element the order forgot rather than dropping it", () => {
    const next = applyDelta(base, {}, 5, { elements: ["c", "a"], edges: [] })

    // "b" is unmentioned; it lands at the end and still renders, which beats vanishing.
    expect(next.elements!.map((e) => e.id)).toEqual(["c", "a", "b"])
  })

  it("upserts cluster settings by their root", () => {
    const withCluster: MindmapDocument = { ...base, clusters: [{ rootId: "a", layoutAlgorithm: "balanced" }] }

    const next = applyDelta(withCluster, { clusters: [{ rootId: "a", layoutAlgorithm: "radial" }] }, 5)

    expect(next.clusters).toEqual([{ rootId: "a", layoutAlgorithm: "radial" }])
  })

  it("returns the same arrays when the delta touches nothing", () => {
    const next = applyDelta(base, {}, 5)

    expect(next.elements).toBe(base.elements)
    expect(next.edges).toBe(base.edges)
  })
})

describe("isEmptyDelta", () => {
  it("is true for a delta with nothing in it", () => {
    expect(isEmptyDelta({})).toBe(true)
    expect(isEmptyDelta({ elements: [], removeEdgeIds: [] })).toBe(true)
  })

  it("is false as soon as anything is set", () => {
    expect(isEmptyDelta({ removeEdgeIds: ["e1"] })).toBe(false)
  })
})
