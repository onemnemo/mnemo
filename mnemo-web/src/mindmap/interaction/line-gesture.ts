import type { LineAttachment } from "../model/document"
import type { Point } from "../model/scene"
import {
  chordDistance,
  lengthAndAngle,
  nearestAnchor,
  snapEnd,
  type AbsoluteLine,
  type AnchorHit,
  type AnchorTarget,
} from "../scene/line-geometry"

export const ANCHOR_SNAP = 14
export const ANCHOR_SHOW = 40
export const STRAIGHTEN_WITHIN = 6
export const DEFAULT_LINE_LENGTH = 160

export type LineEnd = "start" | "end"

export interface EndDrop {
  readonly line: AbsoluteLine
  readonly hit: AnchorHit | null
  readonly target: AnchorTarget | null
}

export function dropEnd(
  origin: AbsoluteLine,
  which: LineEnd,
  pointer: Point,
  targets: readonly AnchorTarget[],
  selfId: string,
  zoom: number,
): EndDrop {
  const candidates = targets.filter((target) => target.id !== selfId)
  const hit = nearestAnchor(candidates, pointer, ANCHOR_SNAP / zoom)
  const near = hit ?? nearestAnchor(candidates, pointer, ANCHOR_SHOW / zoom)
  const target = near ? (candidates.find((candidate) => candidate.id === near.elementId) ?? null) : null
  const point = hit ? hit.point : pointer
  const attachment: LineAttachment | null = hit ? { elementId: hit.elementId, side: hit.side } : null

  const line: AbsoluteLine =
    which === "start"
      ? { ...origin, start: point, startAt: attachment }
      : { ...origin, end: point, endAt: attachment }
  return { line, hit, target }
}

export function dropBend(origin: AbsoluteLine, pointer: Point, zoom: number): AbsoluteLine {
  const straight = chordDistance(pointer, origin.start, origin.end) <= STRAIGHTEN_WITHIN / zoom
  return { ...origin, bend: straight ? null : pointer }
}

export function drawTo(
  start: Point,
  startAt: LineAttachment | null,
  pointer: Point,
  snap: boolean,
  targets: readonly AnchorTarget[],
  zoom: number,
): EndDrop {
  const origin: AbsoluteLine = { start, end: pointer, bend: null, startAt, endAt: null }
  const dropped = dropEnd(origin, "end", pointer, targets, "", zoom)
  if (dropped.hit || !snap) {
    return dropped
  }
  return { ...dropped, line: { ...dropped.line, end: snapEnd(start, pointer) } }
}

export function drawFrom(press: Point, targets: readonly AnchorTarget[], zoom: number): { start: Point; startAt: LineAttachment | null } {
  const hit = nearestAnchor(targets, press, ANCHOR_SNAP / zoom)
  return hit ? { start: hit.point, startAt: { elementId: hit.elementId, side: hit.side } } : { start: press, startAt: null }
}

export function defaultLine(at: Point): AbsoluteLine {
  return { start: at, end: { x: at.x + DEFAULT_LINE_LENGTH, y: at.y }, bend: null, startAt: null, endAt: null }
}

export function readoutText(start: Point, end: Point): string {
  const { length, angle } = lengthAndAngle(start, end)
  return `${Math.round(angle) % 360}° · ${Math.round(length)}`
}
