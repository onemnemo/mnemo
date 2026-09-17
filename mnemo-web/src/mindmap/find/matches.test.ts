import { describe, expect, it } from "vitest"

import { cameraOn, inSceneOrder, stepIndex } from "./matches"
import { MAX_SCALE, type Scene, type SceneElement } from "../model/scene"

function element(id: string): SceneElement {
  return {
    id,
    kind: "node",
    content: { $type: "text", text: id },
    x: 0,
    y: 0,
    width: 100,
    height: 40,
    depth: 0,
    branch: -1,
    nodeShape: "card",
    text: { lines: [id], fontSize: 14, fontWeight: 500, lineHeight: 19, letterSpacing: "-0.005em" },
    padding: { x: 11, y: 7 },
    isRoot: false,
    childCount: 0,
    hiddenCount: 0,
  }
}

const SCENE: Scene = {
  id: "m",
  elements: [element("root"), element("a"), element("b"), element("c")],
  edges: [],
  background: "plain",
}

describe("inSceneOrder", () => {
  it("walks the hits in the order the scene draws them, whatever order they arrived in", () => {
    expect(inSceneOrder(["c", "a", "root"], SCENE)).toEqual(["root", "a", "c"])
  })

  it("leaves out a hit the scene does not hold, which is a node under a collapsed branch", () => {
    expect(inSceneOrder(["a", "folded-away"], SCENE)).toEqual(["a"])
  })

  it("answers nothing for nothing without walking the scene", () => {
    expect(inSceneOrder([], SCENE)).toEqual([])
  })
})

describe("stepIndex", () => {
  it("wraps at both ends", () => {
    expect(stepIndex(2, 3, 1)).toBe(0)
    expect(stepIndex(0, 3, -1)).toBe(2)
  })

  it("starts from the first match going forward and the last going back", () => {
    expect(stepIndex(-1, 3, 1)).toBe(0)
    expect(stepIndex(-1, 3, -1)).toBe(2)
  })

  it("has nowhere to go with no matches", () => {
    expect(stepIndex(-1, 0, 1)).toBe(-1)
    expect(stepIndex(4, 0, -1)).toBe(-1)
  })
})

describe("cameraOn", () => {
  const box = { x: 1000, y: 500, width: 200, height: 50 }

  it("puts the middle of the box in the middle of the pane", () => {
    const camera = cameraOn(box, 800, 600, 1)
    expect(camera.x + 400 / camera.zoom).toBe(1100)
    expect(camera.y + 300 / camera.zoom).toBe(525)
  })

  it("brings an overview zoom up to one a label can be read at", () => {
    expect(cameraOn(box, 800, 600, 0.05).zoom).toBe(1)
  })

  it("keeps a zoom the map was already in at, up to the camera's ceiling", () => {
    expect(cameraOn(box, 800, 600, 2).zoom).toBe(2)
    expect(cameraOn(box, 800, 600, 50).zoom).toBe(MAX_SCALE)
  })
})
