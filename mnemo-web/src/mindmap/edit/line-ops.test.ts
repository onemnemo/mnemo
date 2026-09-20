import { describe, expect, it } from "vitest"

import type { MindmapDocument } from "../model/document"
import type { Scene, SceneElement } from "../model/scene"
import { LINE_PAD } from "../scene/line-geometry"
import { estimateWidth, measurersFrom } from "../scene/measure"
import { projectScene } from "../scene/project"

import { detachOps, lineContent, lineOps, moveOps, resizeLineOps, rotateLineOps } from "./line-ops"

const DOCUMENT: MindmapDocument = {
  id: "m",
  elements: [
    { id: "n", kind: "node", content: { $type: "text", text: "n" }, x: 300, y: 200, width: 80, height: 50 },
    { id: "s", kind: "shape", content: { $type: "shape", shape: "rectangle" }, x: 100, y: 100, width: 100, height: 50 },
    {
      id: "l",
      kind: "shape",
      x: 192,
      y: 117,
      width: 116,
      height: 116,
      content: {
        $type: "shape",
        shape: "arrow",
        line: {
          start: { x: 8, y: 8 },
          end: { x: 108, y: 108 },
          startAt: { elementId: "s", side: "right" },
          endAt: { elementId: "n", side: "left" },
        },
      },
    },
    {
      id: "free",
      kind: "shape",
      x: 0,
      y: 0,
      width: 116,
      height: 16,
      content: { $type: "shape", shape: "line", line: { start: { x: 8, y: 8 }, end: { x: 108, y: 8 } } },
    },
  ],
}

const scene = (): Scene =>
  projectScene(DOCUMENT, { templates: [], defaultTemplateId: "", measurers: measurersFrom(estimateWidth) })
const find = (s: Scene, id: string): SceneElement => s.elements.find((e) => e.id === id)!

describe("writing a line", () => {
  it("stores the padded box of its points and the points relative to it", () => {
    const { content, box } = lineContent(
      { $type: "shape", shape: "line", text: "kept" },
      { start: { x: 10.4, y: 20 }, end: { x: 110, y: 60 }, bend: null, startAt: null, endAt: null },
    )

    expect(box).toEqual({ x: 10 - LINE_PAD, y: 20 - LINE_PAD, width: 100 + 2 * LINE_PAD, height: 40 + 2 * LINE_PAD })
    expect(content.line).toEqual({
      start: { x: LINE_PAD, y: LINE_PAD },
      end: { x: 100 + LINE_PAD, y: 40 + LINE_PAD },
      bend: null,
      startAt: null,
      endAt: null,
    })
    expect(content.text).toBe("kept")
  })

  it("is a set and a move, or a set alone when the origin held still", () => {
    const line = find(scene(), "free")
    const same = lineOps(line, { start: { x: 8, y: 8 }, end: { x: 108, y: 8 }, bend: null, startAt: null, endAt: null })
    const moved = lineOps(line, { start: { x: 50, y: 8 }, end: { x: 108, y: 8 }, bend: null, startAt: null, endAt: null })

    expect(same.map((o) => o.op)).toEqual(["set"])
    expect(moved.map((o) => o.op)).toEqual(["set", "move"])
    expect(moved[1]).toMatchObject({ xy: [42, 0] })
  })
})

describe("moving", () => {
  it("is a bare move for anything that is not a line with a locked end", () => {
    const ops = moveOps(scene(), [{ id: "free", x: 10, y: 10.6 }])

    expect(ops).toEqual([{ op: "move", id: "free", xy: [10, 11], pin: false }])
  })

  it("rewrites a line locked to something that moved so it stays on the border", () => {
    const ops = moveOps(scene(), [{ id: "n", x: 400, y: 200 }])

    expect(ops[0]).toMatchObject({ op: "move", id: "n" })
    const set = ops.find((o) => o.op === "set" && o.id === "l")!
    expect(set).toBeDefined()
    const geometry = (set as { content: { line: { start: { x: number; y: number }; end: { x: number; y: number } } } }).content.line
    expect(ops.find((o) => o.op === "move" && o.id === "l")).toBeUndefined()
    expect(192 + geometry.end.x).toBe(400)
    expect(117 + geometry.end.y).toBe(225)
    expect(192 + geometry.start.x).toBe(200)
    expect(117 + geometry.start.y).toBe(125)
  })

  it("moves a locked line's free parts with it and leaves the locked end on its target", () => {
    const s = scene()
    const half: MindmapDocument = {
      ...DOCUMENT,
      elements: DOCUMENT.elements!.map((e) =>
        e.id === "l"
          ? { ...e, content: { $type: "shape", shape: "arrow", line: { start: { x: 8, y: 8 }, end: { x: 108, y: 108 }, endAt: { elementId: "n", side: "left" } } } }
          : e,
      ),
    }
    const halfScene = projectScene(half, { templates: [], defaultTemplateId: "", measurers: measurersFrom(estimateWidth) })
    const line = find(halfScene, "l")
    const ops = moveOps(halfScene, [{ id: "l", x: line.x + 30, y: line.y + 10 }])

    expect(ops.map((o) => o.op)).toEqual(["set", "move"])
    const geometry = (ops[0] as { content: { line: { start: { x: number; y: number }; end: { x: number; y: number } } } }).content.line
    const move = ops[1] as { xy: [number, number] }
    expect(move.xy[0] + geometry.start.x).toBe(200 + 30)
    expect(move.xy[1] + geometry.start.y).toBe(125 + 10)
    expect(move.xy[0] + geometry.end.x).toBe(300)
    expect(move.xy[1] + geometry.end.y).toBe(225)
    expect(s).toBeDefined()
  })

  it("does not write a line twice when it and its target both moved", () => {
    const ops = moveOps(scene(), [
      { id: "n", x: 400, y: 200 },
      { id: "l", x: 250, y: 150 },
    ])

    expect(ops.filter((o) => o.op === "set" && o.id === "l")).toHaveLength(1)
  })
})

describe("resizing a target", () => {
  it("moves the locked end onto the new border", () => {
    const ops = resizeLineOps(scene(), "n", { x: 300, y: 200, width: 200, height: 50 })

    const set = ops.find((o) => o.op === "set")!
    const geometry = (set as { content: { line: { end: { x: number; y: number } } } }).content.line
    const move = ops.find((o) => o.op === "move") as { xy: [number, number] } | undefined
    expect((move?.xy[0] ?? 192) + geometry.end.x).toBe(300)
    expect((move?.xy[1] ?? 117) + geometry.end.y).toBe(225)
  })
})

describe("rotating a target", () => {
  it("moves attached ends onto the rotated side", () => {
    const ops = rotateLineOps(scene(), "s", 90)

    expect(ops[0]).toMatchObject({ op: "set", id: "s", content: { rotation: 90 } })
    const set = ops.find((operation) => operation.op === "set" && operation.id === "l")!
    const geometry = (set as { content: { line: { start: { x: number; y: number } } } }).content.line
    const move = ops.find((operation) => operation.op === "move" && operation.id === "l") as
      | { xy: [number, number] }
      | undefined
    expect((move?.xy[0] ?? 192) + geometry.start.x).toBe(150)
    expect((move?.xy[1] ?? 117) + geometry.start.y).toBe(175)
  })
})

describe("deleting a target", () => {
  it("lets go of the end where it is drawn and keeps the other attachment", () => {
    const ops = detachOps(scene(), new Set(["n"]))

    expect(ops).toHaveLength(1)
    const content = (ops[0] as { content: { line: { endAt: unknown; startAt: unknown; end: { x: number; y: number } } } }).content
    expect(content.line.endAt).toBeNull()
    expect(content.line.startAt).toEqual({ elementId: "s", side: "right" })
    expect(content.line.end).toEqual({ x: 108, y: 108 })
  })

  it("writes nothing for a line that is itself being deleted", () => {
    expect(detachOps(scene(), new Set(["n", "l"]))).toEqual([])
  })
})

describe("a line locked at both ends inside a moved set", () => {
  it("still says its origin outright, since the server translates its box along with a frame", () => {
    const s = scene()
    const line = find(s, "l")
    const ops = moveOps(s, [{ id: "l", x: line.x + 40, y: line.y + 40 }])

    expect(ops.map((o) => o.op)).toEqual(["set", "move"])
    expect(ops[1]).toMatchObject({ xy: [Math.round(line.x), Math.round(line.y)] })
  })
})

describe("deleting through a subtree", () => {
  it("lets go of a line locked to any id in the set, which the caller widens to the descendants", () => {
    const ops = detachOps(scene(), new Set(["parent-of-n", "n"]))

    expect(ops).toHaveLength(1)
  })
})
