import { describe, expect, it } from "vitest"

import {
  collapseExpands,
  collapseOps,
  colorOps,
  connectManyOps,
  nodeShapeOps,
  pinOps,
  pinUnpins,
  type RingTarget,
} from "./ring-ops"

const node = (id: string, extra: Partial<RingTarget> = {}): RingTarget => ({ id, isNode: true, hasChildren: false, ...extra })
const shape = (id: string): RingTarget => ({ id, isNode: false, hasChildren: false })

describe("colorOps and nodeShapeOps", () => {
  it("style one target with a set and several with one bulk op", () => {
    expect(colorOps([node("a")], "palette.2")).toEqual([{ op: "set", id: "a", style: { stroke: "palette.2" } }])
    expect(colorOps([node("a"), shape("s")], "palette.2")).toEqual([
      { op: "style_subtree", ids: ["a", "s"], style: { stroke: "palette.2" } },
    ])
  })

  it("give a node shape to nodes only", () => {
    expect(nodeShapeOps([node("a"), shape("s"), node("b")], "pill")).toEqual([
      { op: "style_subtree", ids: ["a", "b"], style: { nodeShape: "pill" } },
    ])
    expect(nodeShapeOps([shape("s")], "pill")).toEqual([])
  })
})

describe("collapseOps", () => {
  it("folds every branch while any is open", () => {
    const targets = [node("a", { hasChildren: true, collapsed: true }), node("b", { hasChildren: true }), node("leaf")]
    expect(collapseExpands(targets)).toBe(false)
    expect(collapseOps(targets)).toEqual([
      { op: "set", id: "a", collapsed: true },
      { op: "set", id: "b", collapsed: true },
    ])
  })

  it("unfolds them all once every one is folded", () => {
    const targets = [node("a", { hasChildren: true, collapsed: true }), node("leaf")]
    expect(collapseExpands(targets)).toBe(true)
    expect(collapseOps(targets)).toEqual([{ op: "set", id: "a", collapsed: false }])
  })
})

describe("pinOps", () => {
  it("pins every node while any is loose, and unpins once all are pinned", () => {
    const mixed = [node("a", { pinned: true }), node("b"), shape("s")]
    expect(pinUnpins(mixed)).toBe(false)
    expect(pinOps(mixed)).toEqual([
      { op: "set", id: "a", pinned: true },
      { op: "set", id: "b", pinned: true },
    ])
    const all = [node("a", { pinned: true })]
    expect(pinUnpins(all)).toBe(true)
    expect(pinOps(all)).toEqual([{ op: "set", id: "a", pinned: false }])
  })
})

describe("connectManyOps", () => {
  it("links the primary to each other target, skipping pairs already linked either way", () => {
    const ops = connectManyOps("p", ["p", "a", "b", "c"], [{ fromId: "b", toId: "p" }])
    expect(ops).toEqual([
      { op: "link", a: "p", b: "a" },
      { op: "link", a: "p", b: "c" },
    ])
  })
})
