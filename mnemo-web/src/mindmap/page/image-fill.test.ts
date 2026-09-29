// @vitest-environment jsdom

import { describe, expect, it } from "vitest"

import type { MindmapDocument } from "../model/document"
import type { Scene } from "../model/scene"
import { estimateWidth, measurersFrom } from "../scene/measure"
import { projectScene } from "../scene/project"

import { croppedSize, isImageSlot, refitImage, slotAt } from "./image-fill"

const DOCUMENT: MindmapDocument = {
  id: "m",
  elements: [
    { id: "slot", kind: "image", content: { $type: "canvasImage", assetId: "" }, x: 100, y: 100, width: 240, height: 160 },
    { id: "pic", kind: "image", content: { $type: "canvasImage", assetId: "a.png" }, x: 500, y: 100, width: 200, height: 100 },
    { id: "n", kind: "node", content: { $type: "text", text: "n" }, x: 150, y: 150, width: 80, height: 30 },
  ],
}

const scene = (): Scene =>
  projectScene(DOCUMENT, { templates: [], defaultTemplateId: "", measurers: measurersFrom(estimateWidth) })

describe("finding an empty image", () => {
  it("knows an empty image from a filled one and from a node", () => {
    const s = scene()
    expect(s.elements.filter(isImageSlot).map((element) => element.id)).toEqual(["slot"])
  })

  it("finds the placeholder under a point, and nothing over a filled picture or bare canvas", () => {
    const s = scene()
    expect(slotAt(s, { x: 120, y: 250 })?.id).toBe("slot")
    expect(slotAt(s, { x: 600, y: 150 })).toBeNull()
    expect(slotAt(s, { x: 20, y: 20 })).toBeNull()
  })

  it("answers for the topmost element, so a node over the placeholder takes the drop itself", () => {
    expect(slotAt(scene(), { x: 160, y: 160 })).toBeNull()
  })

  it("reads a rotated element's box as it is drawn", () => {
    const rotated: MindmapDocument = {
      id: "m",
      elements: [
        { id: "slot", kind: "image", content: { $type: "canvasImage", assetId: "" }, x: 0, y: 0, width: 200, height: 200 },
        {
          id: "bar",
          kind: "shape",
          content: { $type: "shape", shape: "rectangle", rotation: 90 },
          x: 90,
          y: 0,
          width: 20,
          height: 200,
        },
      ],
    }
    const s = projectScene(rotated, { templates: [], defaultTemplateId: "", measurers: measurersFrom(estimateWidth) })

    // Upright the bar covers the middle column; turned a quarter, it covers the middle row instead.
    expect(slotAt(s, { x: 100, y: 20 })?.id).toBe("slot")
    expect(slotAt(s, { x: 20, y: 100 })).toBeNull()
  })
})

describe("refitting an image", () => {
  it("swaps the file and resizes about the same centre, in one batch", () => {
    const refit = refitImage(scene(), "slot", { $type: "canvasImage", assetId: "b.png" }, [300, 100])

    expect(refit?.box).toEqual({ x: 70, y: 130, width: 300, height: 100 })
    expect(refit?.ops).toEqual([
      { op: "set", id: "slot", content: { $type: "canvasImage", assetId: "b.png" }, wh: [300, 100] },
      { op: "move", id: "slot", xy: [70, 130], pin: false },
    ])
  })

  it("sends no move when the box keeps its corner", () => {
    const refit = refitImage(scene(), "slot", { $type: "canvasImage", assetId: "" }, [240, 160])

    expect(refit?.ops.map((op) => op.op)).toEqual(["set"])
  })

  it("answers null for an element that is gone or is not an image", () => {
    expect(refitImage(scene(), "missing", { $type: "canvasImage", assetId: "b.png" }, [10, 10])).toBeNull()
    expect(refitImage(scene(), "n", { $type: "canvasImage", assetId: "b.png" }, [10, 10])).toBeNull()
  })

  it("sizes a crop at the width the picture has", () => {
    expect(croppedSize(240, 2)).toEqual([240, 120])
    expect(croppedSize(240, 0.5)).toEqual([240, 480])
  })
})
