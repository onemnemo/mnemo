import { describe, expect, it } from "vitest"

import type { MindmapDocument, MindmapEdge, MindmapElement } from "../model/document"
import { analyzeHierarchy } from "../scene/hierarchy"
import {
  captureOrigin,
  captureSelection,
  offsetPlacement,
  topLevelIds,
  translated,
} from "./clipboard"

const node = (id: string, over: Partial<MindmapElement> = {}): MindmapElement => ({
  id,
  kind: "node",
  content: { $type: "text", text: id },
  ...over,
})

const link = (from: string, to: string): MindmapEdge => ({
  id: `${from}-${to}`,
  fromId: from,
  toId: to,
  kind: "hierarchy",
})

const doc = (elements: MindmapElement[], edges: MindmapEdge[]): MindmapDocument => ({ id: "m", elements, edges })

/** r > a > deep, r > b, and a shape sitting beside all of it. */
const TREE = doc(
  [
    node("r"),
    node("a"),
    node("deep"),
    node("b"),
    { id: "s", kind: "shape", content: { $type: "shape", shape: "rect" } },
  ],
  [link("r", "a"), link("a", "deep"), link("r", "b")],
)

const H = analyzeHierarchy(TREE)

describe("what a selection can carry off", () => {
  it("takes a node's children with it, nested the way they hang", () => {
    const { specs } = captureSelection(TREE, H, ["r"])

    expect(specs).toEqual([
      {
        content: { $type: "text", text: "r" },
        c: [
          { content: { $type: "text", text: "a" }, c: [{ content: { $type: "text", text: "deep" } }] },
          { content: { $type: "text", text: "b" } },
        ],
      },
    ])
  })

  it("carries no id, so what lands is a copy and not the same node again", () => {
    const { specs } = captureSelection(TREE, H, ["a"])

    expect(Object.keys(specs[0]!).sort()).toEqual(["c", "content"])
    expect(Object.keys(specs[0]!.c![0]!)).toEqual(["content"])
  })

  it("drops a child that an ancestor in the same selection already brings", () => {
    const { ids, specs } = captureSelection(TREE, H, ["r", "a", "deep"])

    expect(ids).toEqual(["r"])
    expect(specs).toHaveLength(1)
  })

  it("keeps two branches that hold neither the other", () => {
    const { ids } = captureSelection(TREE, H, ["a", "b"])

    expect(ids).toEqual(["a", "b"])
  })

  it("leaves behind what add cannot plant, since a spec only ever describes a node", () => {
    const { ids } = captureSelection(TREE, H, ["s", "b"])

    expect(ids).toEqual(["b"])
  })

  it("carries nothing at all out of a selection of no nodes", () => {
    expect(captureSelection(TREE, H, ["s"])).toEqual({ ids: [], specs: [] })
  })

  it("gives a copy no coordinates when it is not told where to put it", () => {
    const { specs } = captureSelection(TREE, H, ["a"])

    expect(specs[0]).not.toHaveProperty("xy")
  })

  it("pins every node of a copy when it is, deep ones included", () => {
    const { specs } = captureSelection(TREE, H, ["a"], (id) => ({ x: id === "a" ? 10 : 30, y: 20 }))

    expect(specs[0]!.xy).toEqual([10, 20])
    expect(specs[0]!.c![0]!.xy).toEqual([30, 20])
  })
})

describe("which of the selected are the top of it", () => {
  it("is all of them when none holds another", () => {
    expect(topLevelIds(H, ["a", "b"])).toEqual(["a", "b"])
  })

  it("is the ancestor when one is under the other, however far down", () => {
    expect(topLevelIds(H, ["deep", "r"])).toEqual(["r"])
  })

  it("keeps the order it was given, so a paste reads the way the map does", () => {
    expect(topLevelIds(H, ["b", "a"])).toEqual(["b", "a"])
  })
})

describe("where a duplicate lands", () => {
  const drawn = [{ id: "a", x: 100, y: 50 }]
  const stored = doc([node("a", { x: 7, y: 7 }), node("hidden", { x: 200, y: 90 })], [])

  it("steps off where the node is drawn, not where it was last stored", () => {
    expect(offsetPlacement(stored, drawn, 48, 48)("a")).toEqual({ x: 148, y: 98 })
  })

  it("falls back to the stored pair for a node inside a collapse, which is drawn nowhere", () => {
    expect(offsetPlacement(stored, drawn, 48, 48)("hidden")).toEqual({ x: 248, y: 138 })
  })

  it("has no answer for a node it has never seen, so that one is laid out instead", () => {
    expect(offsetPlacement(stored, drawn, 48, 48)("ghost")).toBeUndefined()
  })
})

describe("moving a copy to where it was asked for", () => {
  /** A branch drawn as a shape: the child sits above and left of its parent. */
  const SHAPED = doc(
    [node("p", { x: 100, y: 100 }), node("c", { x: 40, y: 60 })],
    [link("p", "c")],
  )
  const placed = captureSelection(SHAPED, analyzeHierarchy(SHAPED), ["p"], (id) =>
    id === "p" ? { x: 100, y: 100 } : { x: 40, y: 60 },
  ).specs

  it("measures from the corner of everything, not just the tops", () => {
    expect(captureOrigin(placed)).toEqual({ x: 40, y: 60 })
  })

  it("has no corner when nothing in it was placed", () => {
    expect(captureOrigin(captureSelection(TREE, H, ["r"]).specs)).toBeNull()
  })

  it("keeps the shape of the branch, moving every node by the same step", () => {
    const moved = translated(placed, 10, -5)
    expect(moved[0].xy).toEqual([110, 95])
    expect(moved[0].c?.[0].xy).toEqual([50, 55])
  })

  it("leaves the copy it was given alone", () => {
    translated(placed, 1000, 1000)
    expect(placed[0].xy).toEqual([100, 100])
  })

  it("lands the corner exactly where a paste asks for, however deep the copy is", () => {
    const origin = captureOrigin(placed)!
    const moved = translated(placed, 300 - origin.x, 400 - origin.y)
    expect(captureOrigin(moved)).toEqual({ x: 300, y: 400 })
  })
})
