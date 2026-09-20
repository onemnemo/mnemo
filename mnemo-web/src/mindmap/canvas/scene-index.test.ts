// @vitest-environment jsdom

/**
 * The index had no tests of its own in the spike: its behaviour was only ever checked through the
 * measurement harness, which is not moving. These pin the properties the harness was implicitly
 * relying on, and the one the whole performance argument rests on: every entry point costs what the
 * caller named, never what the document holds.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

import type { Scene, SceneEdge, SceneElement } from "../model/scene"
import { lineLabelPoint } from "../scene/element-geometry"
import { absoluteLine, linePath } from "../scene/line-geometry"

import {
  createSceneIndex,
  edgeCullKey,
  edgeIdFromCullKey,
  nodeCullKey,
  type SceneIndex,
} from "./scene-index"
import { shapePath } from "./shape-path"

function element(id: string, x: number, y: number): SceneElement {
  return {
    id,
    kind: "node",
    content: { $type: "text", text: id },
    x,
    y,
    width: 100,
    height: 40,
    depth: 1,
    branch: 0,
    nodeShape: "card",
    text: { lines: [id], fontSize: 14, fontWeight: 500, lineHeight: 19, letterSpacing: "-0.005em" },
    padding: { x: 11, y: 7 },
    isRoot: false,
    childCount: 0,
    hiddenCount: 0,
  }
}

function edge(id: string, fromId: string, toId: string, label?: string): SceneEdge {
  return { id, fromId, toId, kind: "hierarchy", label }
}

const SCENE: Scene = {
  id: "m",
  elements: [element("a", 0, 0), element("b", 300, 0), element("c", 0, 300)],
  edges: [edge("ab", "a", "b", "leads to"), edge("ac", "a", "c")],
  background: "dots",
}

/** The DOM the renderer is contracted to produce: one host per element, one path per edge. */
function mountPane(): HTMLElement {
  const pane = document.createElement("div")
  for (const e of SCENE.elements) {
    const host = document.createElement("div")
    host.className = "mm-node"
    host.dataset.mmId = e.id
    host.style.transform = `translate(${e.x}px, ${e.y}px)`
    const label = document.createElement("span")
    label.className = "mm-label"
    host.append(label)
    pane.append(host)
  }

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  for (const e of SCENE.edges) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path")
    path.dataset.mmEdge = e.id
    svg.append(path)
    if (e.label) {
      const label = document.createElement("div")
      label.dataset.mmEdgeLabel = e.id
      pane.append(label)
    }
  }
  pane.append(svg)
  document.body.append(pane)
  return pane
}

let pane: HTMLElement
let index: SceneIndex

beforeEach(() => {
  document.body.replaceChildren()
  pane = mountPane()
  index = createSceneIndex(SCENE, pane, "svg")
})

describe("cull keys", () => {
  it("namespace elements and edges into one grid", () => {
    expect(nodeCullKey("x")).not.toBe(edgeCullKey("x"))
  })

  it("read back only for an edge, which is how the canvas mode finds its visible set", () => {
    expect(edgeIdFromCullKey(edgeCullKey("ab"))).toBe("ab")
    expect(edgeIdFromCullKey(nodeCullKey("ab"))).toBeNull()
  })
})

describe("looking things up", () => {
  it("finds the host and label the renderer put in the DOM", () => {
    expect(index.hostFor("a")?.dataset.mmId).toBe("a")
    expect(index.labelFor("a")?.className).toBe("mm-label")
    expect(index.hostFor("nope")).toBeNull()
  })

  it("reports a box from the element's own position and size", () => {
    expect(index.boxOf("b")).toEqual({ x: 300, y: 0, width: 100, height: 40 })
    expect(index.boxOf("nope")).toBeUndefined()
  })
})

describe("writing positions", () => {
  it("writes the transform and moves the box with it", () => {
    index.writePositions(["a"], () => ({ x: 40, y: 60 }))

    expect(index.hostFor("a")!.style.transform).toBe("translate(40px, 60px)")
    expect(index.positionOf("a")).toEqual({ x: 40, y: 60 })
    expect(index.boxOf("a")).toEqual({ x: 40, y: 60, width: 100, height: 40 })
  })

  it("touches only the ids it was given", () => {
    index.writePositions(["a"], () => ({ x: 40, y: 60 }))

    expect(index.hostFor("b")!.style.transform).toBe("translate(300px, 0px)")
  })

  it("skips an id with no position rather than writing a broken transform", () => {
    index.writePositions(["a", "b"], (id) => (id === "a" ? { x: 5, y: 5 } : undefined))

    expect(index.hostFor("b")!.style.transform).toBe("translate(300px, 0px)")
  })
})

describe("incident edges", () => {
  it("finds edges on either endpoint", () => {
    expect([...index.incidentEdges(["b"])]).toEqual(["ab"])
    expect([...index.incidentEdges(["a"])].sort()).toEqual(["ab", "ac"])
  })

  it("deduplicates an edge whose both ends are moving", () => {
    // A frame drag moves both endpoints; repainting the edge twice a frame is not a rounding
    // error at a hundred members.
    expect([...index.incidentEdges(["a", "b"])].sort()).toEqual(["ab", "ac"])
  })

  it("is empty for an element with no edges", () => {
    expect(index.incidentEdges(["nope"])).toEqual([])
  })
})

describe("repainting edges", () => {
  it("rewrites the path geometry from the live boxes, not the ones the scene was built with", () => {
    index.repaintEdges(["ab"])
    const before = pane.querySelector<SVGPathElement>('path[data-mm-edge="ab"]')!.getAttribute("d")

    index.writePositions(["b"], () => ({ x: 900, y: 400 }))
    index.repaintEdges(["ab"])

    expect(pane.querySelector<SVGPathElement>('path[data-mm-edge="ab"]')!.getAttribute("d")).not.toBe(before)
  })

  it("moves the label with the edge", () => {
    index.writePositions(["b"], () => ({ x: 900, y: 400 }))
    index.repaintEdges(["ab"])

    const label = pane.querySelector<HTMLElement>('[data-mm-edge-label="ab"]')!
    expect(label.style.transform).toMatch(/^translate\(-50%, -50%\) translate\(/)
  })

  it("ignores an edge id it does not know", () => {
    expect(() => index.repaintEdges(["nope"])).not.toThrow()
  })
})

describe("cull targets", () => {
  it("cover every element and every edge", () => {
    const keys = index.cullTargets().map((t) => t.key)

    expect(keys).toContain(nodeCullKey("a"))
    expect(keys).toContain(edgeCullKey("ab"))
    expect(keys).toHaveLength(SCENE.elements.length + SCENE.edges.length)
  })

  it("report bounds that follow a moved element", () => {
    const target = index.cullTargets().find((t) => t.key === nodeCullKey("a"))!

    index.writePositions(["a"], () => ({ x: 700, y: 700 }))

    // Live rather than captured: a re-index after a drag has to place the element where it is now.
    expect(target.bounds()).toEqual({ x: 700, y: 700, width: 100, height: 40 })
  })

  it("cover an edge with the union of its endpoints, which a curve stays inside", () => {
    const target = index.cullTargets().find((t) => t.key === edgeCullKey("ab"))!

    expect(target.bounds()).toEqual({ x: 0, y: 0, width: 400, height: 40 })
  })

  it("register no edges at all when nothing draws them", () => {
    const off = createSceneIndex(SCENE, pane, "off")

    expect(off.cullTargets().map((t) => t.key)).toEqual(SCENE.elements.map((e) => nodeCullKey(e.id)))
  })

  it("give a canvas-mode edge its label but no path, since the stroke is not DOM", () => {
    const canvas = createSceneIndex(SCENE, pane, "canvas")
    const withLabel = canvas.cullTargets().find((t) => t.key === edgeCullKey("ab"))!
    const withoutLabel = canvas.cullTargets().find((t) => t.key === edgeCullKey("ac"))!

    expect(withLabel.nodes).toHaveLength(1)
    // Nothing for the culler to hide; the renderer culls it by not drawing it.
    expect(withoutLabel.nodes).toHaveLength(0)
  })
})

describe("rebinding after a substrate swap", () => {
  it("picks up the new layer's paths in place, keeping its own identity", () => {
    const canvas = createSceneIndex(SCENE, pane, "canvas")
    expect(canvas.cullTargets().find((t) => t.key === edgeCullKey("ac"))!.nodes).toHaveLength(0)

    canvas.rebindEdgeDom("svg")

    // The gesture installer was handed this object at mount, so a swap cannot hand back a new one.
    expect(canvas.cullTargets().find((t) => t.key === edgeCullKey("ac"))!.nodes).toHaveLength(1)
  })
})

describe("selection", () => {
  it("marks the current set and clears the previous one", () => {
    index.setSelected(["a", "b"])
    expect(index.hostFor("a")!.dataset.selected).toBeDefined()

    index.setSelected(["b"])

    expect(index.hostFor("a")!.dataset.selected).toBeUndefined()
    expect(index.hostFor("b")!.dataset.selected).toBeDefined()
  })

  it("says how many are selected, for chrome that only makes sense on one", () => {
    index.setSelected(["a", "b"])
    expect(index.hostFor("a")!.dataset.selected).toBe("many")

    index.setSelected(["a"])
    expect(index.hostFor("a")!.dataset.selected).toBe("one")
  })

  it("makes the current camera scale available before selection changes", () => {
    index.writeZoom(2)
    index.setSelected(["a"])

    expect(pane.style.getPropertyValue("--mm-zoom")).toBe("2")
  })
})

describe("writeBox", () => {
  it("writes the size to the host as well as the position", () => {
    index.writeBox("a", { x: 10, y: 20, width: 150, height: 60 })
    const host = index.hostFor("a")!

    expect(host.style.transform).toBe("translate(10px, 20px)")
    expect(host.style.width).toBe("150px")
    expect(host.style.height).toBe("60px")
  })

  it("reports the new box, so an edge meeting it lands on the border that is there now", () => {
    index.writeBox("a", { x: 10, y: 20, width: 150, height: 60 })

    expect(index.boxOf("a")).toMatchObject({ x: 10, y: 20, width: 150, height: 60 })
  })

  it("hands the culler the new bounds rather than the ones it was built with", () => {
    index.writeBox("a", { x: 10, y: 20, width: 150, height: 60 })
    const target = index.cullTargets().find((t) => t.key === nodeCullKey("a"))!

    expect(target.bounds()).toMatchObject({ x: 10, y: 20, width: 150, height: 60 })
  })

  it("redraws a shape's outline, which is drawn to the box rather than scaled into it", () => {
    const host = index.hostFor("a")!
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path")
    path.dataset.mmShape = "diamond"
    svg.append(path)
    host.append(svg)

    index.writeBox("a", { x: 0, y: 0, width: 200, height: 100 })

    expect(svg.getAttribute("width")).toBe("200")
    expect(path.getAttribute("d")).toBe(shapePath("diamond", 200, 100))
  })
})

describe("lines", () => {
  const line = (id: string, attachedTo?: string): SceneElement => ({
    ...element(id, 500, 500),
    kind: "shape",
    content: {
      $type: "shape",
      shape: "line",
      line: { start: { x: 8, y: 8 }, end: { x: 108, y: 8 }, endAt: attachedTo ? { elementId: attachedTo, side: "left" } : null },
    },
    width: 116,
    height: 16,
    text: {
      ...element(id, 500, 500).text,
      lines: ["caption"],
      width: 200,
      height: 30,
    },
    line: {
      start: { x: 8, y: 8 },
      end: { x: 108, y: 8 },
      bend: null,
      startAt: null,
      endAt: attachedTo ? { elementId: attachedTo, side: "left" } : null,
      startCap: "none",
      endCap: "none",
      thickness: 1.5,
      extent: { minX: 500, minY: 500, maxX: 620, maxY: 520 },
    },
  })
  const frame: SceneElement = { ...element("f", 0, 0), kind: "frame", content: { $type: "frame", childIds: [] } }
  const withLines: Scene = {
    ...SCENE,
    elements: [...SCENE.elements, frame, line("free"), line("locked", "b")],
  }

  const mountLines = (): SceneIndex => {
    for (const id of ["f", "free", "locked"]) {
      const host = document.createElement("div")
      host.className = "mm-node"
      host.dataset.mmId = id
      if (id !== "f") {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
        for (const part of ["stroke", "hit", "select"]) {
          const path = document.createElementNS("http://www.w3.org/2000/svg", "path")
          path.setAttribute(`data-mm-line-${part}`, "")
          svg.append(path)
        }
        for (const handle of ["start", "end", "bend"]) {
          const ring = document.createElementNS("http://www.w3.org/2000/svg", "g")
          ring.setAttribute("data-mm-handle", handle)
          ring.append(document.createElementNS("http://www.w3.org/2000/svg", "circle"))
          svg.append(ring)
        }
        host.append(svg)
        const label = document.createElement("div")
        label.setAttribute("data-mm-line-label", "")
        host.append(label)
      }
      pane.append(host)
    }
    return createSceneIndex(withLines, pane, "svg")
  }

  it("knows which lines a move touches: those locked to the moved, and a moved line with a lock", () => {
    const lines = mountLines()

    expect(lines.linesToRepaint(["b"])).toEqual(["locked"])
    expect(lines.linesToRepaint(["locked"])).toEqual(["locked"])
    expect(lines.linesToRepaint(["free"])).toEqual([])
    expect(lines.linesToRepaint(["a"])).toEqual([])
  })

  it("redraws a locked end from the target's live box and keeps the host around the drawing", () => {
    const lines = mountLines()
    lines.writePositions(["b"], () => ({ x: 900, y: 0 }))
    lines.repaintLines(["locked"])

    const host = pane.querySelector<HTMLElement>('[data-mm-id="locked"]')!
    expect(host.querySelector("[data-mm-line-stroke]")!.getAttribute("d")).toBe("M8,496 L400,8")
    const endRing = host.querySelector('[data-mm-handle="end"]')!
    expect(endRing.getAttribute("transform")).toBe("translate(400 8)")
    expect(endRing.querySelector("circle")!.hasAttribute("cx")).toBe(false)
    expect(endRing.querySelector("circle")!.hasAttribute("cy")).toBe(false)
    const live = lines.lineOf("locked")!
    const labelAt = lineLabelPoint(live)
    expect(host.querySelector<HTMLElement>("[data-mm-line-label]")!.style.transform).toBe(
      `translate(${labelAt.x}px, ${labelAt.y}px) translate(-50%, -50%)`,
    )
    expect(host.style.transform).toBe("translate(500px, 12px)")
    expect(host.style.width).toBe("408px")
    expect(host.style.height).toBe("504px")
    expect(lines.lineOf("locked")!.extent.maxX).toBeGreaterThan(900)
  })

  it("keeps a long dragged line local while its locked end stays on the target", () => {
    const lines = mountLines()

    lines.writePositions(["locked"], () => ({ x: -5_000, y: 4_000 }))
    lines.repaintLines(["locked"])
    lines.writePositions(["locked"], () => ({ x: -6_000, y: 4_500 }))
    lines.repaintLines(["locked"])

    const box = lines.boxOf("locked")!
    const line = lines.lineOf("locked")!
    const absolute = absoluteLine(line, box)
    expect(lines.positionOf("locked")).toEqual({ x: -6_000, y: 4_500 })
    expect(absolute.start).toEqual({ x: -5_992, y: 4_508 })
    expect(absolute.end).toEqual({ x: 300, y: 20 })
    const host = pane.querySelector<HTMLElement>('[data-mm-id="locked"]')!
    expect(host.querySelector("[data-mm-line-stroke]")!.getAttribute("d")).toBe(
      linePath(line.start, line.end, line.bend),
    )
    expect(host.querySelector('[data-mm-handle="end"]')!.getAttribute("transform")).toBe(
      `translate(${line.end.x} ${line.end.y})`,
    )
    expect(Math.max(Math.abs(line.start.x), Math.abs(line.start.y), Math.abs(line.end.x), Math.abs(line.end.y))).toBeLessThan(
      Math.max(box.width, box.height),
    )
  })

  it("writes a line through canvas points and its extent with it", () => {
    const lines = mountLines()
    lines.writeLine("free", {
      start: { x: 508, y: 508 },
      end: { x: 700, y: 700 },
      bend: { x: 600, y: 450 },
      startAt: null,
      endAt: null,
    })

    const host = pane.querySelector<HTMLElement>('[data-mm-id="free"]')!
    expect(host.querySelector("[data-mm-line-stroke]")!.getAttribute("d")).toBe("M8,8 Q100,-50 200,200")
    const extent = lines.lineOf("free")!.extent
    expect(extent.minY).toBeLessThan(450)
    expect(extent.maxX).toBeGreaterThan(700)
    const target = lines.cullTargets().find((t) => t.key === nodeCullKey("free"))!
    expect(target.bounds()).toEqual(lines.drawnBoxOf("free"))
  })

  it("offers nodes and closed shapes as anchor targets, never a line or a frame", () => {
    const lines = mountLines()

    expect(lines.anchorTargets().map((t) => t.id)).toEqual(["a", "b", "c"])
  })

  it("writes the zoom once on the inherited root", () => {
    const lines = mountLines()
    lines.writeZoom(0.5)

    expect(pane.style.getPropertyValue("--mm-zoom")).toBe("0.5")
    expect(pane.querySelector<HTMLElement>('[data-mm-id="free"]')!.style.getPropertyValue("--mm-zoom")).toBe("")
  })

  it("does not rewrite the zoom variable when the camera scale is unchanged", () => {
    const lines = mountLines()
    const write = vi.spyOn(pane.style, "setProperty")

    lines.writeZoom(0.5)
    lines.writeZoom(0.5)

    expect(write).toHaveBeenCalledTimes(1)
  })

  it("includes a line caption in its visible bounds without adding the stored host box", () => {
    const lines = mountLines()

    expect(lines.drawnBoxOf("free")).toEqual({ x: 447, y: 486, width: 222, height: 44 })
  })

  it("turns a rotor and reports the turn", () => {
    const lines = mountLines()
    const host = pane.querySelector<HTMLElement>('[data-mm-id="a"]')!
    const rotor = document.createElement("div")
    rotor.setAttribute("data-mm-rotor", "")
    host.append(rotor)
    lines.writeRotation("a", 30)

    expect(rotor.style.rotate).toBe("30deg")
    expect(lines.rotationOf("a")).toBe(30)
    expect(lines.anchorTargets().find((t) => t.id === "a")!.rotation).toBe(30)
  })
})
