import { describe, expect, it } from "vitest"

import type { MindmapDocument, MindmapEdge, MindmapElement } from "../model/document"

import {
  analyzeHierarchy,
  childrenIds,
  grandparentOf,
  hiddenDescendantCount,
  hierarchyEdgesBelow,
  reachedBySelection,
} from "./hierarchy"

const node = (id: string, over: Partial<MindmapElement> = {}): MindmapElement => ({
  id,
  kind: "node",
  content: { $type: "text", text: id },
  ...over,
})

const link = (from: string, to: string, over: Partial<MindmapEdge> = {}): MindmapEdge => ({
  id: `${from}-${to}`,
  fromId: from,
  toId: to,
  kind: "hierarchy",
  ...over,
})

const doc = (elements: MindmapElement[], edges: MindmapEdge[]): MindmapDocument => ({ id: "m", elements, edges })

describe("depth and parentage", () => {
  it("makes a node with no incoming branch a root", () => {
    const h = analyzeHierarchy(doc([node("r"), node("a")], [link("r", "a")]))

    expect(h.rootIds).toEqual(["r"])
    expect(h.byId.get("r")!.depth).toBe(0)
    expect(h.byId.get("a")!.depth).toBe(1)
    expect(h.byId.get("a")!.parentId).toBe("r")
  })

  it("carries the cluster root down, so a template chain can be looked up from any node", () => {
    const h = analyzeHierarchy(doc([node("r"), node("a"), node("b")], [link("r", "a"), link("a", "b")]))

    expect(h.byId.get("b")!.rootId).toBe("r")
    expect(h.byId.get("b")!.depth).toBe(2)
  })

  it("handles a forest, keeping roots in document order", () => {
    const h = analyzeHierarchy(doc([node("one"), node("two"), node("kid")], [link("two", "kid")]))

    expect(h.rootIds).toEqual(["one", "two"])
    expect(h.byId.get("kid")!.rootId).toBe("two")
  })
})

describe("branch assignment", () => {
  it("gives each depth-1 child its own slot, in hierarchy-edge order", () => {
    const h = analyzeHierarchy(
      doc([node("r"), node("a"), node("b"), node("c")], [link("r", "a"), link("r", "b"), link("r", "c")]),
    )

    expect([h.byId.get("a")!.branch, h.byId.get("b")!.branch, h.byId.get("c")!.branch]).toEqual([0, 1, 2])
  })

  it("inherits the branch downward, which is what makes a branch read as one thing", () => {
    const h = analyzeHierarchy(
      doc(
        [node("r"), node("a"), node("b"), node("deep")],
        [link("r", "a"), link("r", "b"), link("b", "deep")],
      ),
    )

    expect(h.byId.get("deep")!.branch).toBe(1)
    expect(h.byId.get("deep")!.depth).toBe(2)
  })

  it("leaves a root with no branch of its own", () => {
    const h = analyzeHierarchy(doc([node("r")], []))

    expect(h.byId.get("r")!.branch).toBe(-1)
  })

  it("follows the edge array's order, because that order is the sibling order", () => {
    // Reversing the edges reverses the branches: nothing else stores which child comes first.
    const h = analyzeHierarchy(doc([node("r"), node("a"), node("b")], [link("r", "b"), link("r", "a")]))

    expect(h.byId.get("b")!.branch).toBe(0)
    expect(h.byId.get("a")!.branch).toBe(1)
  })
})

describe("what is not hierarchy", () => {
  it("ignores a link edge", () => {
    const h = analyzeHierarchy(doc([node("a"), node("b")], [link("a", "b", { kind: "link" })]))

    expect(h.rootIds).toEqual(["a", "b"])
  })

  it("ignores a branch to something that is not a node", () => {
    // A shape cannot parent a node, whatever an edge claims, so the node stays a root.
    const h = analyzeHierarchy(
      doc([{ id: "s", kind: "shape", content: { $type: "shape" } }, node("a")], [link("s", "a")]),
    )

    expect(h.rootIds).toEqual(["a"])
    expect(h.byId.has("s")).toBe(false)
  })

  it("keeps only the first parent when a node somehow has two", () => {
    const h = analyzeHierarchy(
      doc([node("r"), node("x"), node("a")], [link("r", "a"), link("x", "a")]),
    )

    expect(h.byId.get("a")!.parentId).toBe("r")
    expect(childrenIds(h, "x")).toEqual([])
  })

  it("terminates on a cycle rather than walking it forever", () => {
    // The server refuses to write one. A file on disk is not the server.
    const h = analyzeHierarchy(
      doc([node("r"), node("a"), node("b")], [link("r", "a"), link("a", "b"), link("b", "a")]),
    )

    expect(h.byId.get("b")!.depth).toBe(2)
  })
})

describe("collapse", () => {
  it("hides everything under a collapsed node, but not the node itself", () => {
    const h = analyzeHierarchy(
      doc(
        [node("r"), node("a", { collapsed: true }), node("deep"), node("deeper")],
        [link("r", "a"), link("a", "deep"), link("deep", "deeper")],
      ),
    )

    expect(h.byId.get("a")!.hidden).toBe(false)
    expect(h.byId.get("deep")!.hidden).toBe(true)
    expect(h.byId.get("deeper")!.hidden).toBe(true)
  })

  it("leaves a sibling of the collapsed node alone", () => {
    const h = analyzeHierarchy(
      doc(
        [node("r"), node("a", { collapsed: true }), node("b"), node("deep")],
        [link("r", "a"), link("r", "b"), link("a", "deep")],
      ),
    )

    expect(h.byId.get("b")!.hidden).toBe(false)
  })

  it("counts what a collapse is hiding, all the way down", () => {
    const h = analyzeHierarchy(
      doc(
        [node("r"), node("a"), node("b"), node("c")],
        [link("r", "a"), link("a", "b"), link("b", "c")],
      ),
    )

    expect(hiddenDescendantCount(h, "a")).toBe(2)
    expect(hiddenDescendantCount(h, "c")).toBe(0)
  })
})

describe("the edges below a node", () => {
  it("are the ones leaving it and the ones leaving anything under it", () => {
    const document = doc(
      [node("r"), node("a"), node("b"), node("c")],
      [link("r", "a"), link("a", "b"), link("b", "c")],
    )

    expect(hierarchyEdgesBelow(document, analyzeHierarchy(document), "a")).toEqual(["a-b", "b-c"])
  })

  it("stop at the branch, leaving the rest of the map alone", () => {
    const document = doc(
      [node("r"), node("a"), node("b"), node("kid")],
      [link("r", "a"), link("r", "b"), link("b", "kid")],
    )

    expect(hierarchyEdgesBelow(document, analyzeHierarchy(document), "a")).toEqual([])
  })

  it("skip a cross-link, which is a remark rather than part of the branch", () => {
    const document = doc(
      [node("r"), node("a"), node("b"), node("far")],
      [link("r", "a"), link("a", "b"), link("b", "far", { kind: "link" })],
    )

    expect(hierarchyEdgesBelow(document, analyzeHierarchy(document), "a")).toEqual(["a-b"])
  })

  it("include a collapsed branch, which is out of sight rather than out of the map", () => {
    const document = doc(
      [node("r"), node("a", { collapsed: true }), node("deep")],
      [link("r", "a"), link("a", "deep")],
    )

    expect(hierarchyEdgesBelow(document, analyzeHierarchy(document), "a")).toEqual(["a-deep"])
  })

  it("are none for a leaf", () => {
    const document = doc([node("r"), node("a")], [link("r", "a")])

    expect(hierarchyEdgesBelow(document, analyzeHierarchy(document), "a")).toEqual([])
  })
})

describe("grandparentOf", () => {
  it("finds the node two levels up", () => {
    const h = analyzeHierarchy(
      doc([node("r"), node("a"), node("b")], [link("r", "a"), link("a", "b")]),
    )

    expect(grandparentOf(h, "b")).toBe("r")
  })

  it("is null for a root, which has no parent to skip past", () => {
    const h = analyzeHierarchy(doc([node("r")], []))

    expect(grandparentOf(h, "r")).toBeNull()
  })

  it("is null for a depth-one node, whose parent is already the root", () => {
    const h = analyzeHierarchy(doc([node("r"), node("a")], [link("r", "a")]))

    expect(grandparentOf(h, "a")).toBeNull()
  })

  it("is null for an id the hierarchy does not know, and for a null hierarchy", () => {
    const h = analyzeHierarchy(doc([node("r")], []))

    expect(grandparentOf(h, "missing")).toBeNull()
    expect(grandparentOf(null, "r")).toBeNull()
  })
})

describe("reachedBySelection", () => {
  it("is just the selection when nothing selected has children", () => {
    const h = analyzeHierarchy(doc([node("r"), node("a"), node("b")], [link("r", "a"), link("r", "b")]))

    expect(reachedBySelection(h, ["b"])).toEqual(new Set(["b"]))
  })

  it("pulls in every descendant of a selected node, not just its direct children", () => {
    const h = analyzeHierarchy(
      doc(
        [node("r"), node("a"), node("b"), node("c")],
        [link("r", "a"), link("a", "b"), link("b", "c")],
      ),
    )

    expect(reachedBySelection(h, ["a"])).toEqual(new Set(["a", "b", "c"]))
  })

  it("unions across a multi-element selection without double counting", () => {
    const h = analyzeHierarchy(
      doc(
        [node("r"), node("a"), node("b"), node("shared")],
        [link("r", "a"), link("r", "b"), link("a", "shared")],
      ),
    )

    expect(reachedBySelection(h, ["a", "b"])).toEqual(new Set(["a", "b", "shared"]))
  })

  it("reaches a collapsed descendant too, since a delete is not stopped by what a collapse hides", () => {
    const h = analyzeHierarchy(
      doc(
        [node("r"), node("a", { collapsed: true }), node("hidden")],
        [link("r", "a"), link("a", "hidden")],
      ),
    )

    expect(reachedBySelection(h, ["a"])).toEqual(new Set(["a", "hidden"]))
  })

  it("is empty for an empty selection, and unaffected by a null hierarchy", () => {
    const h = analyzeHierarchy(doc([node("r")], []))

    expect(reachedBySelection(h, [])).toEqual(new Set())
    expect(reachedBySelection(null, ["x", "y"])).toEqual(new Set(["x", "y"]))
  })
})

describe("an empty document", () => {
  it("analyses to nothing rather than throwing", () => {
    const h = analyzeHierarchy({ id: "m" })

    expect(h.rootIds).toEqual([])
    expect(h.byId.size).toBe(0)
  })
})
