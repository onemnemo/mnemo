import { describe, expect, it } from "vitest"

import { cssColor } from "../scene/tokens"
import type { SceneElement } from "../model/scene"
import {
  minimapToWorld,
  paintSwatches,
  paintViewport,
  projectMinimap,
  type MinimapContext,
} from "./minimap-paint"

const BOX = { width: 150, height: 98 }

const element = (over: Partial<SceneElement> = {}): SceneElement => ({
  id: "n",
  kind: "node",
  content: { $type: "text", text: "n" },
  x: 0,
  y: 0,
  width: 100,
  height: 40,
  depth: 0,
  branch: -1,
  nodeShape: "card",
  text: { lines: ["n"], fontSize: 14, fontWeight: 500, lineHeight: 19, letterSpacing: "0" },
  padding: { x: 11, y: 7 },
  isRoot: true,
  childCount: 0,
  hiddenCount: 0,
  ...over,
})

interface Drawn {
  readonly op: "fill" | "stroke"
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly color: string
  readonly weight: number
  readonly clipped: boolean
}

/** Records what a real context would have painted, since jsdom has no 2D context to ask. */
function recorder(): MinimapContext & { drawn: Drawn[] } {
  const drawn: Drawn[] = []
  let pending = { x: 0, y: 0, width: 0, height: 0 }
  let clipped = false

  const context: MinimapContext & { drawn: Drawn[] } = {
    drawn,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    save() {},
    restore() {
      clipped = false
    },
    beginPath() {},
    rect() {},
    roundRect(x, y, width, height) {
      pending = { x, y, width, height }
    },
    clip() {
      clipped = true
    },
    fill() {
      drawn.push({ op: "fill", ...pending, color: String(context.fillStyle), weight: 0, clipped })
    },
    stroke() {
      drawn.push({
        op: "stroke",
        ...pending,
        color: String(context.strokeStyle),
        weight: context.lineWidth,
        clipped,
      })
    },
  }
  return context
}

/** Colours come back tagged, so anything unresolved stands out in an assertion. */
const resolve = (color: string) => `[${color}]`

describe("the projection", () => {
  it("centres the map in the box with air around it", () => {
    // Square content in a wider box: the height is the binding side, and the spare width is split.
    const map = projectMinimap([element({ width: 200, height: 200 })], BOX.width, BOX.height)!

    const left = map.offsetX
    const right = 200 * map.scale + map.offsetX
    expect(left).toBeGreaterThan(0)
    expect(right).toBeLessThan(BOX.width)
    expect(left - 0).toBeCloseTo(BOX.width - right, 6)
    // The padding is content, not a margin on the panel, so the map itself never touches the frame.
    expect(minimapToWorld({ x: 0, y: 0 }, map).y).toBeCloseTo(-80, 6)
  })

  it("has no answer for a map with nothing on it", () => {
    expect(projectMinimap([], BOX.width, BOX.height)).toBeNull()
    expect(projectMinimap([element()], 0, 0)).toBeNull()
  })

  it("takes a press back to the point on the map under it", () => {
    const map = projectMinimap([element({ x: 400, y: 300 })], BOX.width, BOX.height)!
    const at = { x: 400 * map.scale + map.offsetX, y: 300 * map.scale + map.offsetY }

    const world = minimapToWorld(at, map)

    expect(world.x).toBeCloseTo(400, 6)
    expect(world.y).toBeCloseTo(300, 6)
  })
})

describe("the swatches", () => {
  it("keeps a swatch visible however large the map is", () => {
    // Two nodes a hundred thousand units apart: at that scale a node is a thousandth of a pixel.
    const context = recorder()
    const elements = [element({ id: "a" }), element({ id: "b", x: 100_000, y: 100_000 })]
    const map = projectMinimap(elements, BOX.width, BOX.height)!

    paintSwatches(context, elements, map, resolve)

    expect(context.drawn).toHaveLength(2)
    for (const swatch of context.drawn) {
      expect(swatch.width).toBeGreaterThanOrEqual(2)
      expect(swatch.height).toBeGreaterThanOrEqual(2)
    }
  })

  it("outlines a frame rather than filling it over its own members", () => {
    const context = recorder()
    const elements = [element({ id: "f", kind: "frame", width: 400, height: 300 }), element({ id: "n", x: 40, y: 40 })]
    const map = projectMinimap(elements, BOX.width, BOX.height)!

    paintSwatches(context, elements, map, resolve)

    expect(context.drawn.map((swatch) => swatch.op)).toEqual(["stroke", "fill"])
  })

  it("falls back from a fill to a branch hue to the muted ink", () => {
    const context = recorder()
    const elements = [
      element({ id: "a", fill: "var(--accent)", stroke: "var(--line)" }),
      // What the cascade produces for a branch coloured node: the hue is on the stroke, and the fill
      // is still the canvas's own paper.
      element({ id: "b", fill: "var(--canvas)", stroke: "var(--branch-3)" }),
      element({ id: "c", fill: "var(--canvas)", stroke: "var(--line)" }),
    ]
    const map = projectMinimap(elements, BOX.width, BOX.height)!

    paintSwatches(context, elements, map, resolve)

    expect(context.drawn.map((swatch) => swatch.color)).toEqual([
      "[var(--accent)]",
      "[var(--branch-3)]",
      "[var(--ink-3)]",
    ])
  })

  it("marks a node nobody has coloured, rather than painting it in the panel's own paper", () => {
    // The whole of the defect: a map of ordinary nodes showed its coloured roots and nothing else.
    const context = recorder()
    const elements = [
      element({ id: "root", fill: "var(--accent)" }),
      ...["a", "b", "c"].map((id, index) =>
        element({
          id,
          x: 200 + index * 40,
          y: 100,
          fill: cssColor("surface"),
          stroke: cssColor("stroke"),
          nodeShape: "plain",
        }),
      ),
    ]
    const map = projectMinimap(elements, BOX.width, BOX.height)!

    paintSwatches(context, elements, map, resolve)

    for (const swatch of context.drawn.slice(1)) {
      expect(swatch.color).toBe("[var(--ink-3)]")
    }
  })

  it("outlines a frame in its own hue, and in the muted ink when it has none", () => {
    const context = recorder()
    const elements = [
      element({ id: "own", kind: "frame", width: 400, height: 300, stroke: "var(--branch-5)" }),
      element({ id: "bare", kind: "frame", x: 500, width: 400, height: 300, stroke: cssColor("stroke") }),
    ]
    const map = projectMinimap(elements, BOX.width, BOX.height)!

    paintSwatches(context, elements, map, resolve)

    expect(context.drawn.map((swatch) => swatch.color)).toEqual(["[var(--branch-5)]", "[var(--ink-3)]"])
  })

  it("colours a frame by its line rather than by whatever is washed inside it", () => {
    const context = recorder()
    const elements = [
      element({ id: "f", kind: "frame", width: 400, height: 300, fill: "var(--branch-2-wash)", stroke: "var(--branch-2)" }),
    ]
    const map = projectMinimap(elements, BOX.width, BOX.height)!

    paintSwatches(context, elements, map, resolve)

    expect(context.drawn[0].color).toBe("[var(--branch-2)]")
  })
})

describe("the viewport rectangle", () => {
  it("is the camera's own box, in the map's scale", () => {
    const context = recorder()
    const map = projectMinimap([element({ width: 1000, height: 1000 })], BOX.width, BOX.height)!

    paintViewport(context, { x: 100, y: 100, zoom: 2 }, { width: 800, height: 600 }, map, BOX, resolve)

    const [rect] = context.drawn
    expect(rect.x).toBeCloseTo(100 * map.scale + map.offsetX, 6)
    expect(rect.width).toBeCloseTo(400 * map.scale, 6)
    expect(rect.height).toBeCloseTo(300 * map.scale, 6)
    expect(rect.clipped).toBe(true)
  })

  it("draws nothing for a pane that has not been laid out yet", () => {
    const context = recorder()
    const map = projectMinimap([element()], BOX.width, BOX.height)!

    paintViewport(context, { x: 0, y: 0, zoom: 1 }, { width: 0, height: 0 }, map, BOX, resolve)

    expect(context.drawn).toHaveLength(0)
  })
})
