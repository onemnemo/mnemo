// @vitest-environment jsdom

/**
 * The index had no tests of its own in the spike: its behaviour was only ever checked through the
 * measurement harness, which is not moving. These pin the properties the harness was implicitly
 * relying on, and the one the whole performance argument rests on: every entry point costs what the
 * caller named, never what the document holds.
 */

import { beforeEach, describe, expect, it } from "vitest"

import type { Scene, SceneEdge, SceneElement } from "../model/scene"

import {
  createSceneIndex,
  edgeCullKey,
  edgeIdFromCullKey,
  nodeCullKey,
  type SceneIndex,
} from "./scene-index"

function element(id: string, x: number, y: number): SceneElement {
  return { id, kind: "node", content: { $type: "text", text: id }, x, y, width: 100, height: 40, depth: 1, branch: 0 }
}

function edge(id: string, fromId: string, toId: string, label?: string): SceneEdge {
  return { id, fromId, toId, kind: "hierarchy", label }
}

const SCENE: Scene = {
  id: "m",
  elements: [element("a", 0, 0), element("b", 300, 0), element("c", 0, 300)],
  edges: [edge("ab", "a", "b", "leads to"), edge("ac", "a", "c")],
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
    expect(index.hostFor("a")!.dataset.selected).toBe("1")

    index.setSelected(["b"])

    expect(index.hostFor("a")!.dataset.selected).toBeUndefined()
    expect(index.hostFor("b")!.dataset.selected).toBe("1")
  })
})
