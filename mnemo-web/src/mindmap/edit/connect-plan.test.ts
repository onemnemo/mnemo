import { describe, expect, it } from "vitest"

import type { ElementKind, MindmapDocument, MindmapEdge, MindmapElement } from "../model/document"
import { adoptPlan, connectOps, forestOf, planConnect } from "./connect-plan"

const el = (id: string, kind: ElementKind = "node") => ({ id, kind, content: {} }) as unknown as MindmapElement

/** Every id is a node unless named in `shapes`; `branches` are parent to child. */
function doc(ids: string[], branches: [string, string][] = [], shapes: string[] = []) {
  const edges: MindmapEdge[] = branches.map(([fromId, toId], index) => ({ id: `e${index}`, fromId, toId }))
  return {
    elements: [...ids.map((id) => el(id)), ...shapes.map((id) => el(id, "shape"))],
    edges,
  } satisfies Pick<MindmapDocument, "elements" | "edges">
}

// r has a, a has a1; b and c are free, c has one child c1.
const MAP = doc(["r", "a", "a1", "b", "c", "c1", "d"], [["r", "a"], ["a", "a1"], ["c", "c1"]], ["s"])

describe("planConnect", () => {
  it("puts a free node under a node in a tree", () => {
    expect(planConnect(forestOf(MAP), "a", "b")).toEqual({ kind: "branch", child: "b", parent: "a" })
  })

  it("puts a free node under a node in a tree when the drag starts on the free one", () => {
    expect(planConnect(forestOf(MAP), "b", "a1")).toEqual({ kind: "branch", child: "b", parent: "a1" })
  })

  it("puts the smaller of two free trees under the larger", () => {
    expect(planConnect(forestOf(MAP), "b", "c")).toEqual({ kind: "branch", child: "b", parent: "c" })
    expect(planConnect(forestOf(MAP), "c", "b")).toEqual({ kind: "branch", child: "b", parent: "c" })
    expect(planConnect(forestOf(MAP), "c", "r")).toEqual({ kind: "branch", child: "c", parent: "r" })
  })

  it("breaks a tie by putting the end the drag landed on under the one it started from", () => {
    expect(planConnect(forestOf(MAP), "b", "d")).toEqual({ kind: "branch", child: "d", parent: "b" })
    expect(planConnect(forestOf(MAP), "d", "b")).toEqual({ kind: "branch", child: "b", parent: "d" })
  })

  it("links two nodes that both already have a parent", () => {
    expect(planConnect(forestOf(MAP), "a1", "c1")).toEqual({ kind: "link" })
  })

  it("links when either end is not a node", () => {
    expect(planConnect(forestOf(MAP), "b", "s")).toEqual({ kind: "link" })
    expect(planConnect(forestOf(MAP), "s", "b")).toEqual({ kind: "link" })
    expect(planConnect(forestOf(MAP), "b", "gone")).toEqual({ kind: "link" })
  })

  it("links rather than loop a root under its own descendant", () => {
    expect(planConnect(forestOf(MAP), "a1", "r")).toEqual({ kind: "link" })
    expect(planConnect(forestOf(MAP), "r", "a1")).toEqual({ kind: "link" })
  })

  it("links rather than move a node out of the frame holding it", () => {
    const framed = {
      elements: [el("p"), el("q"), { id: "f", kind: "frame", content: { $type: "frame", childIds: ["q"] } } as MindmapElement],
      edges: [],
    }
    expect(planConnect(forestOf(framed), "p", "q")).toEqual({ kind: "link" })
  })

  it("links whenever Alt asks for one", () => {
    expect(planConnect(forestOf(MAP), "a", "b", { link: true })).toEqual({ kind: "link" })
  })

  it("reads only hierarchy edges between nodes as parents", () => {
    const linked = {
      elements: [el("x"), el("y"), el("z")],
      edges: [{ id: "l", fromId: "x", toId: "y", kind: "link" as const }],
    }
    expect(planConnect(forestOf(linked), "z", "y")).toEqual({ kind: "branch", child: "y", parent: "z" })
  })
})

describe("connectOps", () => {
  it("writes a branch as a reparent and a link with the connector style", () => {
    const style = { routing: "straight" as const }
    const forest = forestOf(MAP)
    expect(connectOps(forest, { kind: "branch", child: "b", parent: "a" }, "a", "b", style)).toEqual([
      { op: "move", id: "b", under: "a" },
    ])
    expect(connectOps(forest, { kind: "link" }, "a", "b", style)).toEqual([{ op: "link", a: "a", b: "b", style }])
  })

  it("opens a folded parent and unpins the child in the same batch", () => {
    const forest = forestOf({
      elements: [{ ...el("p"), collapsed: true }, { ...el("c"), pinned: true }],
      edges: [],
    })
    const plan = planConnect(forest, "p", "c")
    expect(connectOps(forest, plan, "p", "c")).toEqual([
      { op: "move", id: "c", under: "p" },
      { op: "set", id: "c", pinned: false },
      { op: "set", id: "p", collapsed: false },
    ])
    adoptPlan(forest, plan)
    // Adopted, so a second pair in the same batch does not open or unpin them again.
    expect(forest.collapsed.has("p")).toBe(false)
    expect(forest.pinned.has("c")).toBe(false)
  })

  it("plans a second pair on top of the first once it is adopted", () => {
    const forest = forestOf(doc(["p", "q", "x"]))
    const first = planConnect(forest, "p", "q")
    expect(first).toEqual({ kind: "branch", child: "q", parent: "p" })
    adoptPlan(forest, first)
    // p now has a child, so the free x goes under it rather than the other way round.
    expect(planConnect(forest, "x", "p")).toEqual({ kind: "branch", child: "x", parent: "p" })
  })
})
