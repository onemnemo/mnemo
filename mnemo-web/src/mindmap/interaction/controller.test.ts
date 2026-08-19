// @vitest-environment jsdom

/**
 * The gesture layer at the level a user meets it: press, move, let go.
 *
 * The pieces underneath are covered on their own, and they were all correct while the gesture built
 * out of them was not. What is pinned here is the wiring between them, which is where every fault
 * this module has had actually lived.
 */

import { describe, expect, it } from "vitest"

import type { ElementBox } from "../canvas/edge-paths"
import type { SceneIndex } from "../canvas/scene-index"
import type { Point, Scene, SceneEdge, SceneElement } from "../model/scene"

import { installInteraction, type MovedElement, type NodeChrome } from "./controller"
import type { ResizeBox, ResizeDir } from "./resize"
import { EMPTY_SELECTION, type Selection } from "./selection"
import type { MindmapTool } from "./tool"

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

function edge(id: string, fromId: string, toId: string): SceneEdge {
  return { id, fromId, toId, kind: "hierarchy" }
}

/** A root with two children, one of which has a child of its own, plus one unrelated node. */
const SCENE: Scene = {
  id: "m",
  elements: [
    element("root", 0, 0),
    element("a", 200, -60),
    element("b", 200, 60),
    element("a1", 400, -60),
    element("loose", 200, 400),
  ],
  edges: [edge("r-a", "root", "a"), edge("r-b", "root", "b"), edge("a-a1", "a", "a1")],
  background: "dots",
}

const SUBTREES: Record<string, string[]> = {
  root: ["a", "b", "a1"],
  a: ["a1"],
}

function harness(scene: Scene = SCENE) {
  const pane = document.createElement("div")
  document.body.append(pane)

  const positions = new Map<string, Point>()
  const boxes = new Map<string, ElementBox>()
  const hosts = new Map<string, HTMLElement>()
  const grips = new Map<string, HTMLElement>()
  const chromes = new Map<string, HTMLElement>()
  for (const item of scene.elements) {
    positions.set(item.id, { x: item.x, y: item.y })
    boxes.set(item.id, { x: item.x, y: item.y, width: item.width, height: item.height })
    const host = document.createElement("div")
    host.className = "mm-node"
    host.dataset.mmId = item.id
    // One grip, whose direction each test sets before it presses. The real element renders eight,
    // and which of them was pressed is the only thing the controller reads off any of them.
    const grip = document.createElement("span")
    grip.dataset.mmHandle = "se"
    host.append(grip)
    // Likewise one piece of chrome, whose part each test sets before it presses. A real node wears at
    // most one, and the mark inside it is what a press actually lands on.
    const chrome = document.createElement("span")
    chrome.dataset.mmChrome = "task"
    chrome.append(document.createElement("i"))
    host.append(chrome)
    pane.append(host)
    hosts.set(item.id, host)
    grips.set(item.id, grip)
    chromes.set(item.id, chrome)
  }

  // jsdom implements none of the pointer capture API, and the controller's whole reason for taking
  // capture where it does depends on it being called at the right moment rather than on what it does.
  let captured: number | null = null
  Object.assign(pane, {
    setPointerCapture: (id: number) => {
      captured = id
    },
    hasPointerCapture: (id: number) => captured === id,
    releasePointerCapture: () => {
      captured = null
    },
    focus: () => {},
  })
  pane.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600)

  const repainted: string[][] = []
  const index: SceneIndex = {
    positionOf: (id) => positions.get(id),
    boxOf: (id): ElementBox | undefined => boxes.get(id),
    hostFor: (id) => hosts.get(id) ?? null,
    labelFor: () => null,
    writePositions(ids, at) {
      for (const id of ids) {
        const point = at(id)
        if (!point) continue
        positions.set(id, point)
        const box = boxes.get(id)
        if (box) boxes.set(id, { ...box, x: point.x, y: point.y })
      }
    },
    writeBox(id, box) {
      positions.set(id, { x: box.x, y: box.y })
      boxes.set(id, box)
    },
    writeZoom: () => {},
    incidentEdges(ids) {
      const seen = new Set<string>()
      for (const item of scene.edges) {
        if (ids.includes(item.fromId) || ids.includes(item.toId)) seen.add(item.id)
      }
      return [...seen]
    },
    repaintEdges: (ids) => void repainted.push([...ids]),
    rebindEdgeDom: () => {},
    allEdgeIds: () => scene.edges.map((item) => item.id),
    setSelected: () => {},
    cullTargets: () => [],
  }

  const redraws: (readonly string[] | undefined)[] = []
  const pins: { elements: readonly string[]; edges: readonly string[] }[] = []
  const commits: MovedElement[][] = []
  const resizes: { id: string; box: ResizeBox }[] = []
  const activated: string[] = []
  const planted: { tool: MindmapTool; at: Point }[] = []
  const connected: [string, string][] = []
  const grouped: string[][] = []
  const chromed: [string, NodeChrome][] = []
  let unpins = 0
  let selection: Selection = EMPTY_SELECTION
  let tool: MindmapTool = "select"

  const installed = installInteraction(
    {
      pane,
      index,
      scene,
      subtreeOf: (id) => SUBTREES[id] ?? [],
      // The camera is the runtime's business, and an identity one keeps the arithmetic here about
      // the gesture rather than about a projection.
      toCanvas: (x, y) => ({ x, y }),
      toPane: (point) => point,
      zoom: () => 1,
      redraw: (moved) => void redraws.push(moved),
      pin: (elements, edges) => void pins.push({ elements, edges }),
      unpin: () => {
        unpins += 1
      },
    },
    {
      selection: () => selection,
      setSelection: (next) => {
        selection = next
      },
      tool: () => tool,
      commitMove: (moves) => void commits.push([...moves]),
      commitResize: (id, box) => void resizes.push({ id, box }),
      activate: (id) => void activated.push(id),
      plant: (armed, at) => void planted.push({ tool: armed, at }),
      connect: (fromId, toId) => void connected.push([fromId, toId]),
      group: (ids) => void grouped.push([...ids]),
      chrome: (id, part) => void chromed.push([id, part]),
    },
  )

  const send = (type: string, at: Point, target: EventTarget = pane, init: MouseEventInit = {}): void => {
    const event = new MouseEvent(type, { bubbles: true, clientX: at.x, clientY: at.y, ...init })
    Object.defineProperty(event, "pointerId", { value: 1 })
    target.dispatchEvent(event)
  }

  // A captured pointer retargets its release to the pane, so a connect drag has to look up what is
  // under the pointer. jsdom has no hit testing at all, and this stands in for it.
  let under: Element | null = null
  document.elementFromPoint = () => under

  return {
    pane,
    hosts,
    positions,
    boxes,
    repainted,
    redraws,
    pins,
    commits,
    resizes,
    activated,
    planted,
    connected,
    grouped,
    chromed,
    uninstall: () => {
      installed.uninstall()
      pane.remove()
    },
    cancelGesture: () => installed.cancel(),
    unpinCount: () => unpins,
    selection: () => selection,
    arm: (next: MindmapTool) => {
      tool = next
    },
    hover: (id: string | null) => {
      under = id ? (hosts.get(id) ?? null) : null
    },
    press: (id: string | null, at: Point, init?: MouseEventInit) =>
      send("pointerdown", at, id ? hosts.get(id)! : pane, init),
    pressGrip: (id: string, dir: ResizeDir, at: Point, init?: MouseEventInit) => {
      const grip = grips.get(id)!
      grip.dataset.mmHandle = dir
      send("pointerdown", at, grip, init)
    },
    pressChrome: (id: string, part: NodeChrome, at: Point) => {
      const chrome = chromes.get(id)!
      chrome.dataset.mmChrome = part
      // On the mark inside rather than on the span itself, because that is where a click on a real
      // one lands: the attribute is on what holds the glyph, not on the glyph.
      send("pointerdown", at, chrome.firstElementChild!)
    },
    move: (at: Point) => send("pointermove", at),
    release: (at: Point) => send("pointerup", at),
    cancel: (at: Point) => send("pointercancel", at),
  }
}

describe("installInteraction", () => {
  it("selects on a press that never becomes a drag", () => {
    const h = harness()
    h.press("a", { x: 210, y: -50 })
    h.release({ x: 210, y: -50 })

    expect([...h.selection().elements]).toEqual(["a"])
    expect(h.commits).toHaveLength(0)
    // Nothing was pinned and nothing was captured, because nothing moved.
    expect(h.pins).toHaveLength(0)
    h.uninstall()
  })

  it("does not start a drag inside the slack a click has", () => {
    const h = harness()
    h.press("a", { x: 210, y: -50 })
    h.move({ x: 212, y: -49 })
    h.release({ x: 212, y: -49 })

    expect(h.positions.get("a")).toEqual({ x: 200, y: -60 })
    expect(h.commits).toHaveLength(0)
    h.uninstall()
  })

  it("moves the whole subtree by the same delta", () => {
    const h = harness()
    h.press("a", { x: 210, y: -50 })
    h.move({ x: 260, y: -20 })
    h.move({ x: 310, y: 40 })

    expect(h.positions.get("a")).toEqual({ x: 300, y: 30 })
    expect(h.positions.get("a1")).toEqual({ x: 500, y: 30 })
    // The unrelated node is not in the plan and must not have been written at all.
    expect(h.positions.get("loose")).toEqual({ x: 200, y: 400 })
    h.uninstall()
  })

  it("writes a total delta rather than accumulating one, so a wandering drag lands exactly", () => {
    const h = harness()
    h.press("a", { x: 0, y: 0 })
    for (let step = 1; step <= 40; step++) {
      h.move({ x: step * 7, y: step % 3 })
    }
    h.move({ x: 100, y: 0 })

    expect(h.positions.get("a")).toEqual({ x: 300, y: -60 })
    h.uninstall()
  })

  it("names the edges that moved on every redraw of a drag", () => {
    const h = harness()
    h.press("a", { x: 210, y: -50 })
    h.move({ x: 260, y: -20 })

    // Both of a's edges, because a1 is travelling with it. Without this the canvas substrate
    // repaints the curve each edge had when the drag started and the edges only catch up on release.
    expect(h.redraws).toHaveLength(1)
    expect([...h.redraws[0]!].sort()).toEqual(["a-a1", "r-a"])
    expect([...h.repainted[0]!].sort()).toEqual(["a-a1", "r-a"])
    h.uninstall()
  })

  it("holds the moving set rendered for the length of the gesture", () => {
    const h = harness()
    h.press("a", { x: 210, y: -50 })
    h.move({ x: 260, y: -20 })

    expect(h.pins).toHaveLength(1)
    expect([...h.pins[0]!.elements].sort()).toEqual(["a", "a1"])
    expect([...h.pins[0]!.edges].sort()).toEqual(["a-a1", "r-a"])
    expect(h.unpinCount()).toBe(0)

    h.release({ x: 260, y: -20 })
    expect(h.unpinCount()).toBe(1)
    h.uninstall()
  })

  it("commits one gesture as one call, with every moved element's final position", () => {
    const h = harness()
    h.press("a", { x: 210, y: -50 })
    h.move({ x: 260, y: -20 })
    h.move({ x: 310, y: 40 })
    h.release({ x: 310, y: 40 })

    expect(h.commits).toHaveLength(1)
    expect([...h.commits[0]!].sort((l, r) => l.id.localeCompare(r.id))).toEqual([
      { id: "a", x: 300, y: 30 },
      { id: "a1", x: 500, y: 30 },
    ])
    h.uninstall()
  })

  it("puts everything back when a gesture is cancelled", () => {
    const h = harness()
    h.press("a", { x: 210, y: -50 })
    h.move({ x: 310, y: 40 })
    h.cancel({ x: 310, y: 40 })

    expect(h.positions.get("a")).toEqual({ x: 200, y: -60 })
    expect(h.positions.get("a1")).toEqual({ x: 400, y: -60 })
    expect(h.commits).toHaveLength(0)
    expect(h.unpinCount()).toBe(1)
    h.uninstall()
  })

  it("drags a selected group without collapsing it onto the pressed member", () => {
    const h = harness()
    h.press("a", { x: 210, y: -50 })
    h.release({ x: 210, y: -50 })
    h.press("loose", { x: 210, y: 410 }, { shiftKey: true })

    expect([...h.selection().elements].sort()).toEqual(["a", "loose"])

    h.press("a", { x: 210, y: -50 })
    h.move({ x: 220, y: -40 })
    h.release({ x: 220, y: -40 })

    expect(h.positions.get("a")).toEqual({ x: 210, y: -50 })
    expect(h.positions.get("loose")).toEqual({ x: 210, y: 410 })
    expect([...h.selection().elements].sort()).toEqual(["a", "loose"])
    h.uninstall()
  })

  it("collapses a group onto the member that was clicked rather than dragged", () => {
    const h = harness()
    h.press("a", { x: 210, y: -50 })
    h.release({ x: 210, y: -50 })
    h.press("loose", { x: 210, y: 410 }, { shiftKey: true })

    h.press("a", { x: 210, y: -50 })
    h.release({ x: 210, y: -50 })

    expect([...h.selection().elements]).toEqual(["a"])
    h.uninstall()
  })

  it("clears the selection on a press that lands on nothing", () => {
    const h = harness()
    h.press("a", { x: 210, y: -50 })
    h.release({ x: 210, y: -50 })
    h.press(null, { x: 700, y: 500 })

    expect(h.selection().elements.size).toBe(0)
    h.uninstall()
  })

  it("sweeps what the band touches, and leaves everything else", () => {
    const h = harness()
    h.press(null, { x: 150, y: -100 })
    h.move({ x: 450, y: 20 })
    h.release({ x: 450, y: 20 })

    // a is swallowed whole and a1 is only clipped down its left edge, which is the point: a band
    // catches what it touches. b starts at y 60 and loose at y 400, so the band reaches neither.
    expect([...h.selection().elements].sort()).toEqual(["a", "a1"])
    h.uninstall()
  })

  it("hands a sweep to the frame tool instead of to the selection", () => {
    const h = harness()
    h.arm("frame")
    h.press(null, { x: 150, y: -100 })
    h.move({ x: 450, y: 20 })
    h.release({ x: 450, y: 20 })

    expect(h.grouped.map((ids) => [...ids].sort())).toEqual([["a", "a1"]])
    // The band said what to group, not what to select, and leaving the new frame's members ringed
    // would say the sweep had done both.
    expect(h.selection().elements.size).toBe(0)
    h.uninstall()
  })

  it("groups nothing when the band caught nothing", () => {
    const h = harness()
    h.arm("frame")
    h.press(null, { x: 900, y: 900 })
    h.move({ x: 1000, y: 1000 })
    h.release({ x: 1000, y: 1000 })

    expect(h.grouped).toHaveLength(0)
    h.uninstall()
  })

  it("plants where the press landed, not where it was released", () => {
    const h = harness()
    h.arm("node")
    h.press(null, { x: 640, y: 300 })
    h.move({ x: 700, y: 340 })
    h.release({ x: 700, y: 340 })

    expect(h.planted).toEqual([{ tool: "node", at: { x: 640, y: 300 } }])
    h.uninstall()
  })

  it("does not plant on top of an existing element", () => {
    const h = harness()
    h.arm("text")
    h.press("a", { x: 210, y: -50 })
    h.release({ x: 210, y: -50 })

    expect(h.planted).toHaveLength(0)
    // The press still reads as an ordinary one, since a plant that missed is not a plant.
    expect([...h.selection().elements]).toEqual(["a"])
    h.uninstall()
  })

  it("connects the node a connect drag started on to the one it ended on", () => {
    const h = harness()
    h.arm("connect")
    h.press("a", { x: 210, y: -50 })
    h.move({ x: 215, y: 400 })
    h.hover("loose")
    h.release({ x: 215, y: 410 })

    expect(h.connected).toEqual([["a", "loose"]])
    h.uninstall()
  })

  it("does not connect a node to itself, or to nothing", () => {
    const h = harness()
    h.arm("connect")
    h.press("a", { x: 210, y: -50 })
    h.hover("a")
    h.release({ x: 212, y: -48 })

    h.press("a", { x: 210, y: -50 })
    h.hover(null)
    h.release({ x: 600, y: 600 })

    expect(h.connected).toHaveLength(0)
    h.uninstall()
  })

  it("leaves no preview behind when a connect drag is cancelled", () => {
    const h = harness()
    h.arm("connect")
    h.press("a", { x: 210, y: -50 })
    h.move({ x: 300, y: 100 })
    expect(h.pane.querySelectorAll("svg")).toHaveLength(1)

    h.cancel({ x: 300, y: 100 })
    expect(h.pane.querySelectorAll("svg")).toHaveLength(0)
    expect(h.connected).toHaveLength(0)
    h.uninstall()
  })

  it("never drags an element while the connect tool is armed", () => {
    const h = harness()
    h.arm("connect")
    h.press("a", { x: 210, y: -50 })
    h.move({ x: 400, y: 200 })

    expect(h.positions.get("a")).toEqual({ x: 200, y: -60 })
    expect(h.commits).toHaveLength(0)
    h.uninstall()
  })

  it("ignores a press that belongs to the runtime's pan", () => {
    const h = harness()
    h.press("a", { x: 210, y: -50 }, { altKey: true })
    h.move({ x: 310, y: 40 })

    expect(h.positions.get("a")).toEqual({ x: 200, y: -60 })
    expect(h.selection().elements.size).toBe(0)
    h.uninstall()
  })
})

describe("a resize grip", () => {
  it("changes the box as the pointer moves, without waiting for a threshold", () => {
    const h = harness()
    h.pressGrip("a", "se", { x: 300, y: -20 })
    h.move({ x: 340, y: 0 })

    expect(h.boxes.get("a")).toEqual({ x: 200, y: -60, width: 140, height: 60 })
    h.uninstall()
  })

  it("commits once, on release, with the box it ended on", () => {
    const h = harness()
    h.pressGrip("a", "se", { x: 300, y: -20 })
    h.move({ x: 320, y: -10 })
    h.move({ x: 340, y: 0 })
    h.release({ x: 340, y: 0 })

    expect(h.resizes).toEqual([{ id: "a", box: { x: 200, y: -60, width: 140, height: 60 } }])
    h.uninstall()
  })

  it("takes the position with it when the grip is on the far side", () => {
    const h = harness()
    h.pressGrip("a", "nw", { x: 200, y: -60 })
    h.move({ x: 180, y: -80 })
    h.release({ x: 180, y: -80 })

    expect(h.resizes[0].box).toEqual({ x: 180, y: -80, width: 120, height: 60 })
    h.uninstall()
  })

  it("keeps the element and its branches rendered while it is being dragged", () => {
    const h = harness()
    h.pressGrip("a", "se", { x: 300, y: -20 })
    h.move({ x: 340, y: 0 })

    expect(h.pins).toEqual([{ elements: ["a"], edges: ["r-a", "a-a1"] }])
    expect(h.repainted.at(-1)).toEqual(["r-a", "a-a1"])
    h.release({ x: 340, y: 0 })
    expect(h.unpinCount()).toBe(1)
    h.uninstall()
  })

  it("moves nothing: a grip is not a drag on the element it sits on", () => {
    const h = harness()
    h.pressGrip("a", "se", { x: 300, y: -20 })
    h.move({ x: 340, y: 0 })
    h.release({ x: 340, y: 0 })

    expect(h.positions.get("a1")).toEqual({ x: 400, y: -60 })
    expect(h.commits).toHaveLength(0)
    h.uninstall()
  })

  it("says nothing when the grip was pressed and let go where it stood", () => {
    const h = harness()
    h.pressGrip("a", "se", { x: 300, y: -20 })
    h.release({ x: 300, y: -20 })

    expect(h.resizes).toHaveLength(0)
    h.uninstall()
  })

  it("puts the box back when the gesture is cancelled", () => {
    const h = harness()
    h.pressGrip("a", "se", { x: 300, y: -20 })
    h.move({ x: 500, y: 200 })
    h.cancel({ x: 500, y: 200 })

    expect(h.boxes.get("a")).toEqual({ x: 200, y: -60, width: 100, height: 40 })
    expect(h.resizes).toHaveLength(0)
    expect(h.unpinCount()).toBe(1)
    h.uninstall()
  })

  it("resizes whatever tool is armed, since a grip is only there because it was selected", () => {
    const h = harness()
    h.arm("connect")
    h.pressGrip("a", "se", { x: 300, y: -20 })
    h.move({ x: 340, y: 0 })
    h.release({ x: 340, y: 0 })

    expect(h.resizes).toHaveLength(1)
    expect(h.connected).toHaveLength(0)
    h.uninstall()
  })
})

describe("cancelGesture, the Escape path", () => {
  // Escape does not send a pointercancel; it calls the same revert through a second door. Each
  // gesture kind already proves its revert is correct against the native pointercancel path above,
  // so what is worth pinning here is only that the door itself is wired: cancelGesture() reaches the
  // same resetGesture() and leaves the same gesture-free state behind.
  it("puts a drag back where it started", () => {
    const h = harness()
    h.press("a", { x: 210, y: -50 })
    h.move({ x: 310, y: 40 })
    h.cancelGesture()

    expect(h.positions.get("a")).toEqual({ x: 200, y: -60 })
    expect(h.positions.get("a1")).toEqual({ x: 400, y: -60 })
    expect(h.commits).toHaveLength(0)
    expect(h.unpinCount()).toBe(1)
    h.uninstall()
  })

  it("closes the marquee band without selecting what it was touching", () => {
    const h = harness()
    const before = h.pane.children.length
    h.press(null, { x: 150, y: -100 })
    h.move({ x: 450, y: 20 })
    expect(h.pane.children.length).toBe(before + 1)

    h.cancelGesture()

    expect(h.pane.children.length).toBe(before)
    expect(h.selection().elements.size).toBe(0)
    h.uninstall()
  })

  it("leaves no preview behind when a connect drag is cancelled", () => {
    const h = harness()
    h.arm("connect")
    h.press("a", { x: 210, y: -50 })
    h.move({ x: 300, y: 100 })
    expect(h.pane.querySelectorAll("svg")).toHaveLength(1)

    h.cancelGesture()

    expect(h.pane.querySelectorAll("svg")).toHaveLength(0)
    expect(h.connected).toHaveLength(0)
    h.uninstall()
  })

  it("puts the box back when a resize is cancelled", () => {
    const h = harness()
    h.pressGrip("a", "se", { x: 300, y: -20 })
    h.move({ x: 500, y: 200 })
    h.cancelGesture()

    expect(h.boxes.get("a")).toEqual({ x: 200, y: -60, width: 100, height: 40 })
    expect(h.resizes).toHaveLength(0)
    expect(h.unpinCount()).toBe(1)
    h.uninstall()
  })
})

describe("a node's own chrome", () => {
  it("reports the part that was pressed, and the node it is on", () => {
    const h = harness()
    h.pressChrome("a", "task", { x: 215, y: -50 })

    expect(h.chromed).toEqual([["a", "task"]])
    h.uninstall()
  })

  it("leaves the selection alone, because ticking a box is not picking the node", () => {
    const h = harness()
    h.pressChrome("a", "ref", { x: 215, y: -50 })
    h.release({ x: 215, y: -50 })

    expect(h.chromed).toEqual([["a", "ref"]])
    expect(h.selection().elements.size).toBe(0)
    h.uninstall()
  })

  it("carries the pin badge too, which is a third thing a node answers for itself", () => {
    const h = harness()
    h.pressChrome("a", "pin", { x: 215, y: -50 })

    expect(h.chromed).toEqual([["a", "pin"]])
    h.uninstall()
  })

  it("never drags the node it sits on", () => {
    const h = harness()
    h.pressChrome("a", "task", { x: 215, y: -50 })
    h.move({ x: 400, y: 200 })
    h.release({ x: 400, y: 200 })

    expect(h.positions.get("a")).toEqual({ x: 200, y: -60 })
    expect(h.commits).toHaveLength(0)
    h.uninstall()
  })

  it("means what the armed tool means instead, so a connect drag can start on one", () => {
    const h = harness()
    h.arm("connect")
    h.pressChrome("a", "task", { x: 215, y: -50 })
    h.move({ x: 410, y: -50 })
    h.hover("a1")
    h.release({ x: 410, y: -50 })

    expect(h.chromed).toHaveLength(0)
    expect(h.connected).toEqual([["a", "a1"]])
    h.uninstall()
  })
})
