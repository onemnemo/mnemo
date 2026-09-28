import { describe, expect, it } from "vitest"

import {
  barLayout,
  dockClearance,
  dockOrigin,
  edgeForArrow,
  fitsEdge,
  inlineLength,
  inlineSlot,
  nearestEdge,
  parseEdge,
  placementOf,
  resolveEdge,
  shelfPosition,
  shelfSize,
  type BarItem,
} from "./placement"

const group = (count: number, alwaysShelf = false) => ({ alwaysShelf, options: Array.from({ length: count }) })
const NO_CORNER = { width: 0, height: 0 }
const PANE = { width: 1200, height: 800 }

describe("placementOf", () => {
  it("opens two and four options inside the bar", () => {
    expect(placementOf(group(2))).toBe("inline")
    expect(placementOf(group(4))).toBe("inline")
  })

  it("opens six and eight on a shelf", () => {
    expect(placementOf(group(6))).toBe("shelf")
    expect(placementOf(group(8))).toBe("shelf")
  })

  it("always shelves a group that asks to be, however small", () => {
    expect(placementOf(group(4, true))).toBe("shelf")
  })
})

describe("the inline strip", () => {
  it("is 32 per option, 2 between, 3 of padding each side", () => {
    expect(inlineLength(2)).toBe(72)
    expect(inlineLength(4)).toBe(140)
  })

  it("takes 3 more either side out of the bar", () => {
    expect(inlineSlot(4)).toBe(146)
  })
})

describe("barLayout", () => {
  const items: BarItem[] = [
    { kind: "grip" },
    { kind: "tool", id: "select" },
    { kind: "tray", group: "select", count: 2 },
    { kind: "sep" },
    { kind: "tool", id: "node" },
  ]

  it("lays the items end to end inside the padding, with closed trays taking nothing", () => {
    const layout = barLayout(items, null)

    expect(layout.offsets).toEqual([6, 26, 64, 64, 77])
    expect(layout.length).toBe(6 + 20 + 38 + 13 + 38 + 6)
  })

  it("makes room for the open strip and pushes what follows along", () => {
    const layout = barLayout(items, "select")

    expect(layout.offsets[3]).toBe(64 + inlineSlot(2))
    expect(layout.length).toBe(121 + inlineSlot(2))
  })

  it("matches the design's resting width for ten tools and two dividers", () => {
    const ten: BarItem[] = [
      { kind: "grip" },
      ...Array.from({ length: 10 }, (_, index) => ({ kind: "tool" as const, id: String(index) })),
      { kind: "sep" },
      { kind: "sep" },
    ]
    expect(barLayout(ten, null).length).toBe(438)
  })
})

describe("shelfPosition", () => {
  const bar = { width: 400, height: 48 }
  const shelf = shelfSize(8)

  it("is 8 above a bar docked at the bottom, centred on its tool", () => {
    const small = { width: 100, height: 44 }
    expect(shelfPosition("bottom", bar, 200, small)).toEqual({ x: 150, y: -52 })
  })

  it("is 8 below a bar docked at the top", () => {
    expect(shelfPosition("top", bar, 200, { width: 100, height: 44 }).y).toBe(56)
  })

  it("never overhangs the start of the bar", () => {
    expect(shelfPosition("bottom", bar, 20, { width: 100, height: 44 }).x).toBe(0)
  })

  it("never overhangs the end of the bar", () => {
    expect(shelfPosition("bottom", bar, 390, { width: 100, height: 44 }).x).toBe(300)
  })

  it("centres on the bar when it is wider than the bar", () => {
    expect(shelf.width).toBe(393)
    const narrow = { width: 300, height: 48 }
    expect(shelfPosition("bottom", narrow, 20, shelf).x).toBe((300 - 393) / 2)
  })

  it("sits to the right of a bar on the left, level with its tool", () => {
    const tall = { width: 48, height: 400 }
    expect(shelfPosition("left", tall, 200, shelf)).toEqual({ x: 56, y: 178 })
  })

  it("sits to the left of a bar on the right, clamped to the bar's ends", () => {
    const tall = { width: 48, height: 400 }
    expect(shelfPosition("right", tall, 395, shelf)).toEqual({ x: -8 - 393, y: 356 })
    expect(shelfPosition("right", tall, 5, shelf).y).toBe(0)
  })
})

describe("dockOrigin", () => {
  const horizontal = { width: 400, height: 48 }
  const vertical = { width: 48, height: 400 }

  it("puts each edge 16 in and centred along it", () => {
    expect(dockOrigin("bottom", PANE, horizontal, NO_CORNER)).toEqual({ x: 400, y: 736 })
    expect(dockOrigin("top", PANE, horizontal, NO_CORNER)).toEqual({ x: 400, y: 16 })
    expect(dockOrigin("left", PANE, vertical, NO_CORNER)).toEqual({ x: 16, y: 200 })
    expect(dockOrigin("right", PANE, vertical, NO_CORNER)).toEqual({ x: 1136, y: 200 })
  })

  it("slides a bottom bar left, off the corner block", () => {
    const pane = { width: 800, height: 800 }
    const origin = dockOrigin("bottom", pane, horizontal, { width: 200, height: 170 })
    expect(origin.x + horizontal.width).toBe(800 - 200 - 8)
  })

  it("slides a right bar up, off the corner block", () => {
    const pane = { width: 1200, height: 600 }
    const origin = dockOrigin("right", pane, vertical, { width: 200, height: 170 })
    expect(origin.y + vertical.height).toBe(600 - 170 - 8)
  })

  it("stays centred when it cannot clear the block anyway", () => {
    const pane = { width: 500, height: 800 }
    expect(dockOrigin("bottom", pane, horizontal, { width: 200, height: 170 }).x).toBe(50)
  })
})

describe("fitting an edge", () => {
  it("refuses a side too short for the bar, and falls back to the bottom", () => {
    const short = { width: 1200, height: 380 }
    expect(fitsEdge("left", short, 400, NO_CORNER)).toBe(false)
    expect(resolveEdge("left", short, 400, NO_CORNER)).toBe("bottom")
  })

  it("refuses a top too narrow for the bar", () => {
    expect(fitsEdge("top", { width: 400, height: 800 }, 400, NO_CORNER)).toBe(false)
  })

  it("counts the corner block against the right edge only", () => {
    const pane = { width: 1200, height: 560 }
    const corner = { width: 200, height: 170 }
    expect(fitsEdge("left", pane, 400, corner)).toBe(true)
    expect(fitsEdge("right", pane, 400, corner)).toBe(false)
  })

  it("always takes the bottom", () => {
    expect(fitsEdge("bottom", { width: 100, height: 100 }, 400, NO_CORNER)).toBe(true)
  })
})

describe("nearestEdge", () => {
  it("picks the edge the point is closest to", () => {
    expect(nearestEdge({ x: 600, y: 790 }, PANE)).toBe("bottom")
    expect(nearestEdge({ x: 600, y: 10 }, PANE)).toBe("top")
    expect(nearestEdge({ x: 10, y: 400 }, PANE)).toBe("left")
    expect(nearestEdge({ x: 1190, y: 400 }, PANE)).toBe("right")
  })

  it("settles a dead centre on the bottom", () => {
    expect(nearestEdge({ x: 400, y: 400 }, { width: 800, height: 800 })).toBe("bottom")
  })

  it("skips an edge that would not take the bar", () => {
    expect(nearestEdge({ x: 10, y: 300 }, PANE, ["bottom", "top", "right"])).toBe("top")
  })
})

describe("the keyboard and the setting", () => {
  it("sends the dock to the edge an arrow points at", () => {
    expect(edgeForArrow("ArrowLeft")).toBe("left")
    expect(edgeForArrow("ArrowUp")).toBe("top")
    expect(edgeForArrow("Enter")).toBeNull()
  })

  it("reads an unknown stored edge as the bottom", () => {
    expect(parseEdge("diagonal")).toBe("bottom")
    expect(parseEdge("right")).toBe("right")
  })

  it("reserves only the docked edge for other floating bars", () => {
    expect(dockClearance("left")).toEqual({ bottom: 0, top: 0, left: 72, right: 0 })
  })
})
