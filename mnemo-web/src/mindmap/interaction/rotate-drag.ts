import type { Point } from "../model/scene"
import type { SceneIndex } from "../canvas/scene-index"
import type { ResizeBox } from "./resize"
import { angleAt, centreOf, normalizeDeg, snapDeg } from "./rotate"

export interface RotateDragSurface {
  readonly pane: HTMLElement
  readonly index: SceneIndex
  toCanvas(clientX: number, clientY: number): Point
  redraw(): void
  pin(elementIds: readonly string[], edgeIds: readonly string[]): void
  unpin(): void
}

export interface RotateDrag {
  readonly kind: "rotate"
  readonly pointerId: number
  readonly id: string
  readonly centre: Point
  readonly origin: number
  readonly offset: number
  readonly lines: readonly string[]
  degrees: number
}

export function beginRotate(
  surface: RotateDragSurface,
  id: string,
  box: ResizeBox,
  pointerId: number,
  press: Point,
): RotateDrag {
  const { index } = surface
  const centre = centreOf(box)
  const origin = index.rotationOf(id)
  const lines = index.linesToRepaint([id])
  surface.pane.setPointerCapture(pointerId)
  surface.pin([id, ...lines], [])
  return { kind: "rotate", pointerId, id, centre, origin, offset: angleAt(centre, press) - origin, lines, degrees: origin }
}

export function moveRotate(surface: RotateDragSurface, drag: RotateDrag, event: PointerEvent): void {
  const at = surface.toCanvas(event.clientX, event.clientY)
  const raw = normalizeDeg(angleAt(drag.centre, at) - drag.offset)
  drag.degrees = event.shiftKey ? snapDeg(raw) : raw
  surface.index.writeRotation(drag.id, drag.degrees)
  surface.index.repaintLines(drag.lines)
  surface.redraw()
}

export function endRotate(
  surface: RotateDragSurface,
  drag: RotateDrag,
  commit: (id: string, degrees: number) => void,
): void {
  surface.unpin()
  if (Math.round(drag.degrees) !== Math.round(drag.origin)) {
    commit(drag.id, drag.degrees)
  }
}

export function cancelRotate(surface: RotateDragSurface, drag: RotateDrag): void {
  surface.index.writeRotation(drag.id, drag.origin)
  surface.index.repaintLines(drag.lines)
  surface.redraw()
  surface.unpin()
}
