import { describe, expect, it } from "vitest"

import { ON_CANVAS, onElements, pickOf, splitPick } from "./sectors"
import { GROUPS } from "./toolbar/groups"

const ELEMENTS = onElements({ collapsed: false, pinned: false })
const NONE = new Set<string>()
const forget = () => null

describe("the rings", () => {
  it("hold eight sectors each, whatever the targets' state", () => {
    expect(ON_CANVAS).toHaveLength(8)
    for (const collapsed of [false, true]) {
      for (const pinned of [false, true]) {
        expect(onElements({ collapsed, pinned }).map((sector) => sector.id)).toEqual(ELEMENTS.map((sector) => sector.id))
      }
    }
  })

  it("point the actions the two rings share the same way", () => {
    const at = (ring: typeof ON_CANVAS, id: string) => ring.findIndex((sector) => sector.id === id)
    expect(at(ON_CANVAS, "shape")).toBe(at(ELEMENTS, "node-shape"))
    expect(at(ON_CANVAS, "insert")).toBe(at(ELEMENTS, "link"))
    expect(at(ON_CANVAS, "frame")).toBe(at(ELEMENTS, "group"))
  })

  it("name what the toggling sectors would do", () => {
    const named = (collapsed: boolean, pinned: boolean) =>
      onElements({ collapsed, pinned })
        .filter((sector) => sector.id === "collapse" || sector.id === "pin")
        .map((sector) => sector.nameKey)
    expect(named(false, false)).toEqual(["CollapseBranch", "Pin"])
    expect(named(true, true)).toEqual(["ExpandBranch", "Unpin"])
  })

  it("offer the toolbar's shapes, in its order", () => {
    const shapes = ON_CANVAS.find((sector) => sector.id === "shape")?.sub?.map((item) => item.id)
    expect(shapes).toEqual(GROUPS.shape.options.map((option) => `shape:${option.id}`))
  })

  it("give everything pickable in a ring its own id", () => {
    for (const ring of [ON_CANVAS, ELEMENTS]) {
      const ids = ring.flatMap((sector) => [sector.id, ...(sector.sub ?? []).map((item) => item.id)])
      expect(new Set(ids).size).toBe(ids.length)
    }
  })
})

describe("pickOf", () => {
  it("picks nothing over the hub", () => {
    expect(pickOf(ON_CANVAS, { hot: null, sub: null }, NONE, forget)).toBeNull()
  })

  it("picks a sub item by its own id, and a plain sector by its", () => {
    expect(pickOf(ON_CANVAS, { hot: 6, sub: 1 }, NONE, forget)).toBe("layout:treeRight")
    expect(pickOf(ON_CANVAS, { hot: 0, sub: null }, NONE, forget)).toBe("node")
  })

  it("repeats the last item picked when released on a sector with a sub-ring, and does nothing before one was", () => {
    expect(pickOf(ELEMENTS, { hot: 0, sub: null }, NONE, forget)).toBeNull()
    expect(pickOf(ELEMENTS, { hot: 0, sub: null }, NONE, (id) => (id === "color" ? "color:3" : null))).toBe("color:3")
  })

  it("never picks a dimmed sector or item", () => {
    expect(pickOf(ELEMENTS, { hot: 2, sub: null }, new Set(["connect"]), forget)).toBeNull()
    expect(pickOf(ELEMENTS, { hot: 6, sub: 6 }, new Set(["align:distributeHorizontal"]), forget)).toBeNull()
  })
})

describe("splitPick", () => {
  it("separates a sub item's value from its sector", () => {
    expect(splitPick("color:3")).toEqual(["color", "3"])
    expect(splitPick("align:centerHorizontal")).toEqual(["align", "centerHorizontal"])
    expect(splitPick("connect")).toEqual(["connect", ""])
  })
})
