import type { ShapeType } from "../model/document"
import type { Point } from "../model/scene"
import { absoluteLine, sameLine, type AbsoluteLine, type AnchorTarget } from "../scene/line-geometry"
import type { SceneIndex } from "../canvas/scene-index"
import { defaultLine, drawFrom, drawTo, dropBend, dropEnd, readoutText, type LineEnd } from "./line-gesture"
import { openLineOverlay, type LineOverlay } from "./line-overlay"

export interface LineDragSurface {
  readonly pane: HTMLElement
  readonly index: SceneIndex
  toCanvas(clientX: number, clientY: number): Point
  toPane(point: Point): Point
  zoom(): number
  redraw(): void
  pin(elementIds: readonly string[], edgeIds: readonly string[]): void
  unpin(): void
}

export interface LineDragHandlers {
  commitLine(id: string, line: AbsoluteLine): void
  draw(shape: ShapeType, line: AbsoluteLine): void
}

export interface LineEndDrag {
  readonly kind: "lineEnd"
  readonly pointerId: number
  readonly id: string
  readonly which: LineEnd
  readonly origin: AbsoluteLine
  readonly overlay: LineOverlay
  readonly targets: readonly AnchorTarget[]
  line: AbsoluteLine
}

export interface BendDrag {
  readonly kind: "bend"
  readonly pointerId: number
  readonly id: string
  readonly origin: AbsoluteLine
  line: AbsoluteLine
}

export interface DrawDrag {
  readonly kind: "draw"
  readonly pointerId: number
  readonly shape: ShapeType
  readonly start: Point
  readonly startAt: AbsoluteLine["startAt"]
  readonly overlay: LineOverlay
  readonly targets: readonly AnchorTarget[]
  line: AbsoluteLine
}

export type LineDrag = LineEndDrag | BendDrag | DrawDrag

export function beginLineDrag(
  surface: LineDragSurface,
  id: string,
  handle: LineEnd | "bend",
  pointerId: number,
): LineEndDrag | BendDrag | null {
  const { index, pane } = surface
  const line = index.lineOf(id)
  const box = index.boxOf(id)
  if (!line || !box) {
    return null
  }
  const origin = absoluteLine(line, box)
  pane.setPointerCapture(pointerId)
  surface.pin([id], [])
  if (handle === "bend") {
    return { kind: "bend", pointerId, id, origin, line: origin }
  }
  return {
    kind: "lineEnd",
    pointerId,
    id,
    which: handle,
    origin,
    overlay: openLineOverlay(pane),
    targets: index.anchorTargets(),
    line: origin,
  }
}

export function beginDraw(surface: LineDragSurface, shape: ShapeType, pointerId: number, press: Point): DrawDrag {
  surface.pane.setPointerCapture(pointerId)
  const targets = surface.index.anchorTargets()
  const { start, startAt } = drawFrom(press, targets, surface.zoom())
  return {
    kind: "draw",
    pointerId,
    shape,
    start,
    startAt,
    overlay: openLineOverlay(surface.pane),
    targets,
    line: { start, end: start, bend: null, startAt, endAt: null },
  }
}

export function moveLineDrag(surface: LineDragSurface, drag: LineDrag, event: PointerEvent): void {
  const { index } = surface
  const at = surface.toCanvas(event.clientX, event.clientY)

  if (drag.kind === "lineEnd") {
    const drop = dropEnd(drag.origin, drag.which, at, drag.targets, drag.id, surface.zoom())
    drag.line = drop.line
    index.writeLine(drag.id, drop.line)
    drag.overlay.showAnchors(drop.target, drop.hit?.side ?? null, surface.toPane)
    surface.redraw()
    return
  }

  if (drag.kind === "bend") {
    drag.line = dropBend(drag.origin, at, surface.zoom())
    index.writeLine(drag.id, drag.line)
    surface.redraw()
    return
  }

  const drop = drawTo(drag.start, drag.startAt, at, event.shiftKey, drag.targets, surface.zoom())
  drag.line = drop.line
  drag.overlay.showPreview(drop.line.start, drop.line.end, surface.toPane)
  drag.overlay.showAnchors(drop.target, drop.hit?.side ?? null, surface.toPane)
  const bounds = surface.pane.getBoundingClientRect()
  drag.overlay.showReadout(
    { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
    readoutText(drop.line.start, drop.line.end),
  )
}

export function endLineDrag(surface: LineDragSurface, drag: LineDrag, handlers: LineDragHandlers): void {
  if (drag.kind === "draw") {
    drag.overlay.remove()
    handlers.draw(drag.shape, drag.line)
    return
  }
  if (drag.kind === "lineEnd") {
    drag.overlay.remove()
  }
  surface.unpin()
  if (!sameLine(drag.origin, drag.line)) {
    handlers.commitLine(drag.id, drag.line)
  }
}

export function cancelLineDrag(surface: LineDragSurface, drag: LineDrag): void {
  dropOverlay(drag)
  if (drag.kind === "draw") {
    return
  }
  surface.index.writeLine(drag.id, drag.origin)
  surface.redraw()
  surface.unpin()
}

export function dropOverlay(drag: LineDrag): void {
  if (drag.kind !== "bend") {
    drag.overlay.remove()
  }
}

export function plantDefaultLine(shape: ShapeType, at: Point, handlers: LineDragHandlers): void {
  handlers.draw(shape, defaultLine(at))
}
