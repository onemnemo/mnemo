import { describe, expect, it } from "vitest"

import { ON_CANVAS, ON_SEVERAL, onNode, pickOf, ringContext, splitPick } from "./sectors"
import { GROUPS } from "./toolbar/groups"

describe("ringContext", () => {
  it("opens the canvas ring on nothing, the node ring on one, and the several ring on more", () => {
    expect(ringContext(0)).toBe("canvas")
    expect(ringContext(1)).toBe("node")
    expect(ringContext(2)).toBe("multi")
    expect(ringContext(40)).toBe("multi")
  })
})

describe("the sets", () => {
  it("keep one size whatever the node's state", () => {
    expect(onNode(true).map((sector) => sector.id)).toEqual(onNode(false).map((sector) => sector.id))
    expect(ON_CANVAS).toHaveLength(6)
    expect(onNode(false)).toHaveLength(9)
    expect(ON_SEVERAL).toHaveLength(6)
  })

  it("name what the collapse sector would do", () => {
    const name = (collapsed: boolean) => onNode(collapsed).find((sector) => sector.id === "collapse")?.nameKey
    expect(name(false)).toBe("CollapseBranch")
    expect(name(true)).toBe("ExpandBranch")
  })

  it("offer the toolbar's shapes, in its order", () => {
    const shapes = ON_CANVAS.find((sector) => sector.id === "shape")?.sub?.map((item) => item.id)
    expect(shapes).toEqual(GROUPS.shape.options.map((option) => `shape:${option.id}`))
  })

  it("give every pickable thing in a set its own id", () => {
    for (const sectors of [ON_CANVAS, onNode(false), ON_SEVERAL]) {
      for (const sector of sectors) {
        const ids = (sector.sub ?? []).map((item) => item.id)
        expect(new Set(ids).size).toBe(ids.length)
      }
      const ids = sectors.map((sector) => sector.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })
})

describe("pickOf", () => {
  it("picks nothing over the hub", () => {
    expect(pickOf(ON_CANVAS, { hot: null, sub: null })).toBeNull()
  })

  it("picks a sub item by its own id", () => {
    expect(pickOf(ON_CANVAS, { hot: 4, sub: 1 })).toBe("layout:treeRight")
  })

  it("runs a sector's own action, and nothing for a sector that only opens its sub-ring", () => {
    expect(pickOf(ON_CANVAS, { hot: 1, sub: null })).toBe("shape")
    expect(pickOf(ON_CANVAS, { hot: 3, sub: null })).toBeNull()
    expect(pickOf(ON_SEVERAL, { hot: 0, sub: null })).toBeNull()
    expect(pickOf(ON_SEVERAL, { hot: 4, sub: null })).toBe("duplicate")
  })
})

describe("splitPick", () => {
  it("separates a sub item's value from its sector", () => {
    expect(splitPick("color:3")).toEqual(["color", "3"])
    expect(splitPick("layout:treeRight")).toEqual(["layout", "treeRight"])
    expect(splitPick("align:centerHorizontal")).toEqual(["align", "centerHorizontal"])
  })

  it("leaves a plain sector id alone", () => {
    expect(splitPick("duplicate")).toEqual(["duplicate", ""])
  })
})
