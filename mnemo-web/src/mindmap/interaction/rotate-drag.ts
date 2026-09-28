import type { Point } from "../model/scene"
import type { SceneIndex } from "../canvas/scene-index"
import type { ResizeBox } from "./resize"
import { holdGrip, openChip, placeAngleChip, releaseGrip, wholeDegrees } from "./gesture-readout"
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
  readonly knob: Element | null
  readonly chip: HTMLElement
  degrees: number
}

export function beginRotate(
  surface: RotateDragSurface,
  id: string,
  box: ResizeBox,
  event: PointerEvent,
  press: Point,
): RotateDrag {
  const { index } = surface
  const centre = centreOf(box)
  const origin = index.rotationOf(id)
  const lines = index.linesToRepaint([id])
  const pointerId = event.pointerId
  surface.pane.setPointerCapture(pointerId)
  surface.pin([id, ...lines], [])
  const chip = openChip(surface.pane)
  placeAngleChip(chip, surface.pane, event.clientX, event.clientY, origin)
  return {
    kind: "rotate",
    pointerId,
    id,
    centre,
    origin,
    offset: angleAt(centre, press) - origin,
    lines,
    knob: holdGrip(event.target),
    chip,
    degrees: origin,
  }
}

export function moveRotate(surface: RotateDragSurface, drag: RotateDrag, event: PointerEvent): void {
  const at = surface.toCanvas(event.clientX, event.clientY)
  const raw = normalizeDeg(angleAt(drag.centre, at) - drag.offset)
  drag.degrees = event.shiftKey ? snapDeg(raw) : raw
  surface.index.writeRotation(drag.id, drag.degrees)
  surface.index.repaintLines(drag.lines)
  surface.redraw()
  drag.knob?.setAttribute("aria-valuenow", String(wholeDegrees(drag.degrees)))
  placeAngleChip(drag.chip, surface.pane, event.clientX, event.clientY, drag.degrees)
}

export function endRotate(
  surface: RotateDragSurface,
  drag: RotateDrag,
  commit: (id: string, degrees: number) => void,
): void {
  dropReadout(drag)
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
  dropReadout(drag)
  drag.knob?.setAttribute("aria-valuenow", String(wholeDegrees(drag.origin)))
}

export function dropReadout(drag: RotateDrag): void {
  drag.chip.remove()
  releaseGrip(drag.knob)
}
