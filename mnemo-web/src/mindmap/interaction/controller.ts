/**
 * The pointer state machine: what a press on the map turns into.
 *
 * It lives outside React for the same reason the camera does. A drag writes positions at pointer
 * rate, and a position that lives in a component is a position that costs a render to change; the
 * only things that reach React from here are the discrete ones, a selection changing and a gesture
 * committing, which happen once per gesture rather than once per frame.
 *
 * A gesture is decided on the first move, not on the press. Press on a node and hold still and it is
 * a click; press and move three pixels and the same press was the start of a drag. Deciding on the
 * press instead means either no marquee or no drag, since both begin identically.
 */

import { planDrag, positionAt, type DragPlan } from "../canvas/drag-plan"
import type { SceneIndex } from "../canvas/scene-index"
import type { Point, Scene, SceneElement } from "../model/scene"
import { hitEdge } from "./hit-test"
import { elementsInRect, rectBetween } from "./marquee"
import type { MindmapTool } from "./tool"
import {
  addElements,
  EMPTY_SELECTION,
  isSelected,
  selectElements,
  selectOnly,
  toggle,
  type Selection,
} from "./selection"

/** Client pixels of slack, summed across both axes, before a press becomes a drag. */
const DRAG_THRESHOLD = 4

/** Click target around an edge's centreline, in screen pixels; divided by zoom to reach canvas. */
const EDGE_HIT_PIXELS = 7

export interface MovedElement {
  readonly id: string
  readonly x: number
  readonly y: number
}

export interface InteractionSurface {
  readonly pane: HTMLElement
  readonly index: SceneIndex
  readonly scene: Scene
  /**
   * Every descendant of a node in the hierarchy, collapsed ones included.
   *
   * Read from the document rather than the scene, because a collapsed subtree is absent from the
   * scene and still has stored coordinates that have to travel with the parent.
   */
  subtreeOf(id: string): readonly string[]
  toCanvas(clientX: number, clientY: number): Point
  /** The inverse, in pixels from the pane's top-left. What a preview drawn over the map needs. */
  toPane(point: Point): Point
  zoom(): number
  /**
   * Redraws whatever the substrate owns after positions moved under it, naming the edges that
   * moved with them. Naming matters: the canvas substrate caches an edge as a flattened curve and
   * has no way to notice that an endpoint went somewhere else.
   */
  redraw(movedEdgeIds?: readonly string[]): void
  /** Holds these elements and edges rendered wherever the gesture takes them. */
  pin(elementIds: readonly string[], edgeIds: readonly string[]): void
  unpin(): void
}

export interface InteractionHandlers {
  /** Read rather than passed, because the controller outlives any one selection. */
  selection(): Selection
  setSelection(next: Selection): void
  /** Which tool is armed. Read at press time for the same reason the selection is. */
  tool(): MindmapTool
  /** A drag finished, with every moved element's final position. One gesture, one call. */
  commitMove(moves: readonly MovedElement[]): void
  /** A double click, which is how a label asks to be edited. */
  activate(id: string): void
  /** An armed creation tool was used on empty canvas. */
  plant(tool: MindmapTool, at: Point): void
  /** A sweep with the frame tool armed. Never called with nothing caught. */
  group(ids: readonly string[]): void
  /** A connect drag landed on a node. Whether that links or unlinks is the caller's to decide. */
  connect(fromId: string, toId: string): void
}

type Gesture =
  | { readonly kind: "none" }
  | {
      readonly kind: "press"
      readonly pointerId: number
      /** Null when the press landed on empty canvas, which is where a marquee starts. */
      readonly elementId: string | null
      readonly startClient: Point
      readonly startCanvas: Point
      /** Deferred until the press turns out to be a click, so a multi-drag keeps its selection. */
      readonly selectOnUp: boolean
      readonly additive: boolean
    }
  | {
      readonly kind: "drag"
      readonly pointerId: number
      readonly plan: DragPlan
      readonly incident: readonly string[]
      readonly startCanvas: Point
      readonly moves: MovedElement[]
    }
  | {
      readonly kind: "marquee"
      readonly pointerId: number
      readonly startClient: Point
      readonly startCanvas: Point
      readonly additive: boolean
      /** What the sweep is for. Decided when it starts, so a tool change mid-gesture cannot rewrite it. */
      readonly groups: boolean
      readonly box: HTMLElement
    }
  | {
      readonly kind: "connect"
      readonly pointerId: number
      readonly fromId: string
      readonly line: SVGSVGElement
    }

export function installInteraction(
  surface: InteractionSurface,
  handlers: InteractionHandlers,
): () => void {
  const { pane, index, scene } = surface

  // Membership is an explicit id list rather than derived containment, so a frame is wherever its
  // members are and dragging one takes them along without a containment query per frame.
  const frameMembers = new Map<string, readonly string[]>()
  for (const element of scene.elements) {
    if (element.content.$type === "frame") {
      const childIds = (element.content as { childIds?: string[] }).childIds
      if (childIds?.length) {
        frameMembers.set(element.id, childIds)
      }
    }
  }

  /**
   * What travels with an element: a frame's members, or a node's whole subtree.
   *
   * A branch is a thing rather than an arrangement of things, and dragging a topic away from its
   * children would stretch the branches rather than move the idea. This is the one place the port
   * needs it explicitly, because layout here is freeform until Arrange: there is no engine that will
   * quietly reflow the children afterwards the way the desktop's does.
   *
   * A frame's list is expanded through the same rule before it is handed over, since the drag plan
   * expands one level only by design and a member that is a topic still owns its branch.
   */
  const travellingWith = (id: string): readonly string[] | undefined => {
    const members = frameMembers.get(id)
    if (!members) {
      return surface.subtreeOf(id)
    }
    const travelling = new Set(members)
    for (const memberId of members) {
      for (const descendantId of surface.subtreeOf(memberId)) {
        travelling.add(descendantId)
      }
    }
    return [...travelling]
  }

  let gesture: Gesture = { kind: "none" }

  const elementAt = (target: EventTarget | null): string | null =>
    (target as HTMLElement | null)?.closest?.<HTMLElement>(".mm-node")?.dataset.mmId ?? null

  const edgeAt = (point: Point): string | null =>
    hitEdge({
      edges: scene.edges,
      boxOf: (id) => index.boxOf(id),
      point,
      tolerance: EDGE_HIT_PIXELS / surface.zoom(),
    })

  const onPointerDown = (event: PointerEvent): void => {
    // Middle and alt-left are the runtime's pan, and a secondary click opens a menu rather than
    // moving anything. Neither is this module's business.
    if (event.button !== 0 || event.altKey || gesture.kind !== "none") {
      return
    }

    // Nothing here calls preventDefault. Cancelling a pointerdown suppresses the compatibility
    // mouse events it would have produced, and dblclick is one of them, so a node press that
    // prevented its default was a node that could never be double clicked into edit. Text
    // selection is held off by the pane's own select-none instead.

    // So the map answers the keyboard without needing a second click somewhere neutral.
    pane.focus({ preventScroll: true })

    const additive = event.shiftKey || event.ctrlKey || event.metaKey
    const startClient = { x: event.clientX, y: event.clientY }
    const startCanvas = surface.toCanvas(event.clientX, event.clientY)
    const elementId = elementAt(event.target)
    const tool = handlers.tool()

    // A connect drag is a drag by definition, so it needs no threshold and takes the capture at
    // once. It starts on a node and nowhere else; pressing empty canvas with it armed still clears
    // the selection below, which is the only sensible reading of that press.
    if (tool === "connect" && elementId) {
      pane.setPointerCapture(event.pointerId)
      const line = openConnectLine(pane)
      gesture = { kind: "connect", pointerId: event.pointerId, fromId: elementId, line }
      handlers.setSelection(selectOnly("element", elementId))
      drawConnectLine(line, anchorOf(surface, elementId), panePoint(pane, startClient))
      return
    }

    // Planting reads the press rather than the release: the point under the pointer is where the
    // element goes, and waiting for the release would let a twitch move it.
    if ((tool === "node" || tool === "text" || tool === "shape") && !elementId) {
      handlers.plant(tool, startCanvas)
      return
    }

    if (elementId) {
      const selection = handlers.selection()
      const already = isSelected(selection, "element", elementId)

      if (additive) {
        handlers.setSelection(toggle(selection, "element", elementId))
        return
      }
      // Pressing something already selected must not collapse the selection, or dragging a group
      // would drag one member of it. The collapse happens on release, if there was no drag.
      if (!already) {
        handlers.setSelection(selectOnly("element", elementId))
      }

      gesture = {
        kind: "press",
        pointerId: event.pointerId,
        elementId,
        startClient,
        startCanvas,
        selectOnUp: already && selectionCount(selection) > 1,
        additive,
      }
      return
    }

    const edgeId = edgeAt(startCanvas)
    if (edgeId) {
      const selection = handlers.selection()
      handlers.setSelection(additive ? toggle(selection, "edge", edgeId) : selectOnly("edge", edgeId))
      return
    }

    if (!additive) {
      handlers.setSelection(EMPTY_SELECTION)
    }

    gesture = {
      kind: "press",
      pointerId: event.pointerId,
      elementId: null,
      startClient,
      startCanvas,
      selectOnUp: false,
      additive,
    }
  }

  /**
   * Capture is taken here rather than on the press.
   *
   * A captured pointer retargets the compatibility mouse events it produces, click and dblclick
   * included, to whatever holds the capture. Capturing on the press therefore made every node
   * undoubleclickable: the dblclick arrived at the pane with the node nowhere in its path. A gesture
   * that turns out to be a drag needs the capture; one that turns out to be a click never does.
   */
  const beginDrag = (press: Extract<Gesture, { kind: "press" }>): Gesture => {
    const plan = planDrag({
      pressedId: press.elementId!,
      selection: handlers.selection().elements,
      membersOf: travellingWith,
      positionOf: (id) => index.positionOf(id),
    })
    // Once per gesture, not once per frame: which edges touch the moving set cannot change while
    // the set is moving.
    const incident = index.incidentEdges(plan.ids)
    pane.setPointerCapture(press.pointerId)
    surface.pin(plan.ids, incident)
    return {
      kind: "drag",
      pointerId: press.pointerId,
      plan,
      incident,
      startCanvas: press.startCanvas,
      moves: [],
    }
  }

  const beginMarquee = (press: Extract<Gesture, { kind: "press" }>): Gesture => {
    pane.setPointerCapture(press.pointerId)
    return {
      kind: "marquee",
      pointerId: press.pointerId,
      startClient: press.startClient,
      startCanvas: press.startCanvas,
      additive: press.additive,
      groups: handlers.tool() === "frame",
      box: openMarquee(pane),
    }
  }

  const onPointerMove = (event: PointerEvent): void => {
    if (gesture.kind === "none" || event.pointerId !== gesture.pointerId) {
      return
    }

    if (gesture.kind === "connect") {
      drawConnectLine(
        gesture.line,
        anchorOf(surface, gesture.fromId),
        panePoint(pane, { x: event.clientX, y: event.clientY }),
      )
      return
    }

    if (gesture.kind === "press") {
      const far =
        Math.abs(event.clientX - gesture.startClient.x) +
          Math.abs(event.clientY - gesture.startClient.y) >
        DRAG_THRESHOLD
      if (!far) {
        return
      }
      gesture = gesture.elementId ? beginDrag(gesture) : beginMarquee(gesture)
    }

    if (gesture.kind === "drag") {
      const drag = gesture
      const at = surface.toCanvas(event.clientX, event.clientY)
      // Origin plus TOTAL delta rather than an accumulated per-event one. Accumulation drifts over a
      // long gesture, and members drifting apart from their frame is the failure this prevents.
      const dx = at.x - drag.startCanvas.x
      const dy = at.y - drag.startCanvas.y

      const moves: MovedElement[] = []
      const landing = new Map<string, Point>()
      for (const id of drag.plan.ids) {
        const point = positionAt(drag.plan, id, dx, dy)
        if (point) {
          moves.push({ id, x: point.x, y: point.y })
          landing.set(id, point)
        }
      }
      drag.moves.length = 0
      drag.moves.push(...moves)

      index.writePositions(drag.plan.ids, (id) => landing.get(id))
      index.repaintEdges(drag.incident)
      surface.redraw(drag.incident)
      return
    }

    if (gesture.kind === "marquee") {
      drawMarquee(gesture.box, pane, gesture.startClient, { x: event.clientX, y: event.clientY })
    }
  }

  const onPointerUp = (event: PointerEvent): void => {
    if (gesture.kind === "none" || event.pointerId !== gesture.pointerId) {
      return
    }
    const finished = gesture
    gesture = { kind: "none" }
    releaseCapture(pane, event.pointerId)

    if (finished.kind === "press") {
      // A press that never moved is a click, and this is where a click on an already-selected member
      // of a group finally collapses the selection onto it. A press on empty canvas that never moved
      // is just a click on empty canvas, which the press already answered by clearing the selection.
      if (finished.selectOnUp && finished.elementId) {
        handlers.setSelection(selectOnly("element", finished.elementId))
      }
      return
    }

    if (finished.kind === "drag") {
      surface.unpin()
      if (finished.moves.length > 0) {
        handlers.commitMove(finished.moves)
      }
      return
    }

    if (finished.kind === "connect") {
      finished.line.remove()
      // Capture retargets the release to the pane, so the node under the pointer has to be looked
      // up by position rather than read off the event.
      const landed = elementAt(document.elementFromPoint(event.clientX, event.clientY))
      if (landed && landed !== finished.fromId) {
        handlers.connect(finished.fromId, landed)
      }
      return
    }

    finished.box.remove()
    const rect = rectBetween(finished.startCanvas, surface.toCanvas(event.clientX, event.clientY))
    // A band this small is a click that wobbled, and treating it as a sweep would clear the
    // selection the press just made. Measured in screen pixels so it means the same at every zoom.
    const zoom = surface.zoom()
    if (rect.width * zoom < 4 && rect.height * zoom < 4) {
      return
    }
    const hits = elementsInRect(rect, sweepable(scene))

    // The frame tool sweeps the same way selection does, and for the same reason: what a frame holds
    // is a set of elements, and a rectangle dragged around them is how anyone says which.
    if (finished.groups) {
      if (hits.length > 0) {
        handlers.group(hits)
      }
      return
    }

    // Replace on release rather than add, which is deliberate and matches the desktop: a marquee is
    // how you say "these", and shift is how you say "and these too".
    handlers.setSelection(
      finished.additive ? addElements(handlers.selection(), hits) : selectElements(hits),
    )
  }

  const onPointerCancel = (event: PointerEvent): void => {
    if (gesture.kind === "none" || event.pointerId !== gesture.pointerId) {
      return
    }
    if (gesture.kind === "marquee") {
      gesture.box.remove()
    }
    if (gesture.kind === "connect") {
      gesture.line.remove()
    }
    if (gesture.kind === "drag") {
      // Put everything back. A cancelled gesture that leaves the nodes where the pointer left them
      // is an edit nobody asked for and nothing recorded.
      const plan = gesture.plan
      index.writePositions(plan.ids, (id) => plan.origins.get(id))
      index.repaintEdges(gesture.incident)
      surface.redraw(gesture.incident)
      surface.unpin()
    }
    gesture = { kind: "none" }
    releaseCapture(pane, event.pointerId)
  }

  const onDoubleClick = (event: MouseEvent): void => {
    const elementId = elementAt(event.target)
    if (elementId) {
      event.preventDefault()
      handlers.activate(elementId)
    }
  }

  pane.addEventListener("pointerdown", onPointerDown)
  pane.addEventListener("pointermove", onPointerMove)
  pane.addEventListener("pointerup", onPointerUp)
  pane.addEventListener("pointercancel", onPointerCancel)
  pane.addEventListener("dblclick", onDoubleClick)

  return () => {
    pane.removeEventListener("pointerdown", onPointerDown)
    pane.removeEventListener("pointermove", onPointerMove)
    pane.removeEventListener("pointerup", onPointerUp)
    pane.removeEventListener("pointercancel", onPointerCancel)
    pane.removeEventListener("dblclick", onDoubleClick)
    if (gesture.kind === "marquee") {
      gesture.box.remove()
    }
    if (gesture.kind === "connect") {
      gesture.line.remove()
    }
  }
}

function selectionCount(selection: Selection): number {
  return selection.elements.size + selection.edges.size
}

/**
 * The scene's boxes, minus the frames.
 *
 * A frame is a background, and a marquee dragged across the canvas inevitably crosses one; catching
 * it would move the frame and every member with it when the user meant to catch two of the members.
 */
function sweepable(scene: Scene): readonly SceneElement[] {
  return scene.elements.filter((element) => element.kind !== "frame")
}

/* -------------------------------------------------------------------------- */
/* The rubber band                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Written to the DOM directly rather than rendered.
 *
 * It changes on every pointer move, and it is one absolutely positioned rectangle. Routing that
 * through React would cost a render of the whole canvas subtree per frame of the gesture, to move
 * four numbers on one element.
 */
function openMarquee(pane: HTMLElement): HTMLElement {
  const box = document.createElement("div")
  // Styled here rather than in a stylesheet because it is the only element this module owns, and a
  // rule in a global sheet for one node created and destroyed inside one gesture is a rule nobody
  // will find. The colours are still tokens, so it follows the theme.
  box.style.cssText = [
    "position:absolute",
    "left:0",
    "top:0",
    "pointer-events:none",
    "border:1px solid var(--accent)",
    "background:color-mix(in oklab, var(--accent) 10%, transparent)",
    "border-radius:2px",
  ].join(";")
  pane.appendChild(box)
  return box
}

function drawMarquee(box: HTMLElement, pane: HTMLElement, from: Point, to: Point): void {
  const bounds = pane.getBoundingClientRect()
  const rect = rectBetween(
    { x: from.x - bounds.left, y: from.y - bounds.top },
    { x: to.x - bounds.left, y: to.y - bounds.top },
  )
  box.style.transform = `translate(${rect.x}px, ${rect.y}px)`
  box.style.width = `${rect.width}px`
  box.style.height = `${rect.height}px`
}

/* -------------------------------------------------------------------------- */
/* The connect preview                                                        */
/* -------------------------------------------------------------------------- */

const SVG_NS = "http://www.w3.org/2000/svg"

/**
 * Drawn in pane pixels rather than canvas ones.
 *
 * One end of this line is a node and the other is the pointer, and the pointer is only ever known
 * in screen coordinates. Projecting the node forward is one multiplication; projecting the pointer
 * back would have to be undone again to draw it.
 */
function openConnectLine(pane: HTMLElement): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg")
  svg.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:30"
  const line = document.createElementNS(SVG_NS, "line")
  line.setAttribute("stroke", "var(--accent)")
  line.setAttribute("stroke-width", "1.5")
  line.setAttribute("stroke-dasharray", "4 3")
  line.setAttribute("stroke-linecap", "round")
  svg.append(line)
  pane.append(svg)
  return svg
}

function drawConnectLine(svg: SVGSVGElement, from: Point, to: Point): void {
  const line = svg.firstElementChild
  if (!line) {
    return
  }
  line.setAttribute("x1", String(from.x))
  line.setAttribute("y1", String(from.y))
  line.setAttribute("x2", String(to.x))
  line.setAttribute("y2", String(to.y))
}

/** The middle of an element, in pane pixels. Where a connector is drawn from. */
function anchorOf(surface: InteractionSurface, id: string): Point {
  const box = surface.index.boxOf(id)
  if (!box) {
    return { x: 0, y: 0 }
  }
  return surface.toPane({ x: box.x + box.width / 2, y: box.y + box.height / 2 })
}

function panePoint(pane: HTMLElement, client: Point): Point {
  const bounds = pane.getBoundingClientRect()
  return { x: client.x - bounds.left, y: client.y - bounds.top }
}

function releaseCapture(pane: HTMLElement, pointerId: number): void {
  if (pane.hasPointerCapture(pointerId)) {
    pane.releasePointerCapture(pointerId)
  }
}
