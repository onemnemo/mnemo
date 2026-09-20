/** Stored points are box-relative. Absolute line values are in canvas space. */

import type { AnchorSide, ArrowCap, LineAttachment, ShapeContent, ShapeType } from "../model/document"
import { pointOf } from "../model/document"
import type { Bounds, Point, SceneElement, SceneLine } from "../model/scene"
import { capRadiusFactor } from "./cap-geometry"

export interface Box {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface AnchorTarget {
  readonly id: string
  readonly box: Box
  readonly rotation?: number
}

export interface AnchorHit {
  readonly elementId: string
  readonly side: AnchorSide
  readonly point: Point
}

export interface AbsoluteLine {
  readonly start: Point
  readonly end: Point
  readonly bend: Point | null
  readonly startAt: LineAttachment | null
  readonly endAt: LineAttachment | null
}

export const DEFAULT_THICKNESS = 1.5

// Fixed padding keeps zero-height lines hostable without moving their origin when weight changes.
export const LINE_PAD = 8

export const ANCHOR_SIDES: readonly AnchorSide[] = ["top", "right", "bottom", "left"]

export function isLineShape(shape: ShapeType | undefined): boolean {
  return shape === "line" || shape === "arrow"
}

export function isAttachmentTarget(
  element: Pick<SceneElement, "kind" | "line"> | undefined,
): element is Pick<SceneElement, "kind" | "line"> {
  return element !== undefined && (element.kind === "node" || (element.kind === "shape" && !element.line))
}

export function anchorPoint(box: Box, side: AnchorSide, rotation = 0): Point {
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  let px = cx
  let py = cy
  switch (side) {
    case "top":
      py = box.y
      break
    case "right":
      px = box.x + box.width
      break
    case "bottom":
      py = box.y + box.height
      break
    case "left":
      px = box.x
      break
  }
  if (!rotation) {
    return { x: px, y: py }
  }
  const rad = (rotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const dx = px - cx
  const dy = py - cy
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos }
}

export function nearestAnchor(
  candidates: readonly AnchorTarget[],
  point: Point,
  radius: number,
): AnchorHit | null {
  let best: AnchorHit | null = null
  let bestDistance = radius
  for (const candidate of candidates) {
    const { box } = candidate
    const reach = radius + (candidate.rotation ? Math.hypot(box.width, box.height) / 2 : 0)
    if (
      point.x < box.x - reach ||
      point.x > box.x + box.width + reach ||
      point.y < box.y - reach ||
      point.y > box.y + box.height + reach
    ) {
      continue
    }
    for (const side of ANCHOR_SIDES) {
      const at = anchorPoint(candidate.box, side, candidate.rotation)
      const distance = Math.hypot(at.x - point.x, at.y - point.y)
      if (distance <= bestDistance) {
        bestDistance = distance
        best = { elementId: candidate.id, side, point: at }
      }
    }
  }
  return best
}

/** Missing legacy geometry resolves to the former bottom-left to top-right diagonal. */
export function resolveLine(
  content: ShapeContent,
  box: Box,
  targetOf: (id: string) => AnchorTarget | undefined,
): SceneLine {
  const shape = content.shape ?? "rectangle"
  const geometry = content.line
  const stored = geometry
    ? { start: pointOf(geometry.start), end: pointOf(geometry.end), bend: geometry.bend ? pointOf(geometry.bend) : null }
    : { start: { x: 0, y: box.height }, end: { x: box.width, y: 0 }, bend: null }

  const startAt = geometry?.startAt ?? null
  const endAt = geometry?.endAt ?? null
  const start = attachedPoint(startAt, box, targetOf) ?? stored.start
  const end = attachedPoint(endAt, box, targetOf) ?? stored.end
  const thickness = content.thickness ?? DEFAULT_THICKNESS
  const startCap = content.startCap ?? "none"
  const endCap = content.endCap ?? (shape === "arrow" ? "arrow" : "none")

  const points = [absolute(start, box), absolute(end, box)]
  if (stored.bend) {
    points.push(absolute(stored.bend, box))
  }

  return {
    start,
    end,
    bend: stored.bend,
    startAt,
    endAt,
    startCap,
    endCap,
    thickness,
    extent: extentOf(points, thickness, startCap, endCap),
  }
}

function attachedPoint(
  attachment: LineAttachment | null,
  box: Box,
  targetOf: (id: string) => AnchorTarget | undefined,
): Point | undefined {
  if (!attachment) {
    return undefined
  }
  const target = targetOf(attachment.elementId)
  if (!target) {
    return undefined
  }
  const at = anchorPoint(target.box, attachment.side ?? "top", target.rotation)
  return { x: at.x - box.x, y: at.y - box.y }
}

export function absolute(point: Point, box: Box): Point {
  return { x: point.x + box.x, y: point.y + box.y }
}

export function relative(point: Point, box: Box): Point {
  return { x: point.x - box.x, y: point.y - box.y }
}

export function absoluteLine(line: SceneLine, box: Box): AbsoluteLine {
  return {
    start: absolute(line.start, box),
    end: absolute(line.end, box),
    bend: line.bend ? absolute(line.bend, box) : null,
    startAt: line.startAt,
    endAt: line.endAt,
  }
}

export function lineBox(points: readonly Point[]): Box {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const point of points) {
    if (point.x < minX) minX = point.x
    if (point.y < minY) minY = point.y
    if (point.x > maxX) maxX = point.x
    if (point.y > maxY) maxY = point.y
  }
  return {
    x: minX - LINE_PAD,
    y: minY - LINE_PAD,
    width: maxX - minX + 2 * LINE_PAD,
    height: maxY - minY + 2 * LINE_PAD,
  }
}

function overhang(thickness: number, cap: ArrowCap): number {
  return 4 + thickness * capRadiusFactor(cap)
}

export function extentOf(
  absolutePoints: readonly Point[],
  thickness: number,
  startCap: ArrowCap,
  endCap: ArrowCap,
): Bounds {
  const pad = Math.max(overhang(thickness, startCap), overhang(thickness, endCap))
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const point of absolutePoints) {
    if (point.x < minX) minX = point.x
    if (point.y < minY) minY = point.y
    if (point.x > maxX) maxX = point.x
    if (point.y > maxY) maxY = point.y
  }
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad }
}

export function linePath(start: Point, end: Point, bend: Point | null): string {
  if (bend) {
    return `M${n(start.x)},${n(start.y)} Q${n(bend.x)},${n(bend.y)} ${n(end.x)},${n(end.y)}`
  }
  return `M${n(start.x)},${n(start.y)} L${n(end.x)},${n(end.y)}`
}

function n(value: number): string {
  return String(Math.round(value * 1000) / 1000)
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

export function chordDistance(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) {
    return Math.hypot(point.x - a.x, point.y - a.y)
  }
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared))
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy))
}

/** Returns counter-clockwise degrees from the positive x axis despite the downward canvas y axis. */
export function lengthAndAngle(from: Point, to: Point): { length: number; angle: number } {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const angle = (Math.atan2(-dy, dx) * 180) / Math.PI
  return { length: Math.hypot(dx, dy), angle: angle < 0 ? angle + 360 : angle }
}

export function snapAngle(degrees: number, step = 15): number {
  const snapped = Math.round(degrees / step) * step
  return ((snapped % 360) + 360) % 360
}

export function snapEnd(start: Point, end: Point, step = 15): Point {
  const { length, angle } = lengthAndAngle(start, end)
  const rad = (snapAngle(angle, step) * Math.PI) / 180
  return { x: start.x + length * Math.cos(rad), y: start.y - length * Math.sin(rad) }
}

export function sameLine(a: AbsoluteLine, b: AbsoluteLine): boolean {
  return (
    samePoint(a.start, b.start) &&
    samePoint(a.end, b.end) &&
    (a.bend === null ? b.bend === null : b.bend !== null && samePoint(a.bend, b.bend)) &&
    sameAttachment(a.startAt, b.startAt) &&
    sameAttachment(a.endAt, b.endAt)
  )
}

function samePoint(a: Point, b: Point): boolean {
  return Math.round(a.x) === Math.round(b.x) && Math.round(a.y) === Math.round(b.y)
}

function sameAttachment(a: LineAttachment | null, b: LineAttachment | null): boolean {
  if (!a || !b) {
    return a === b
  }
  return a.elementId === b.elementId && (a.side ?? "top") === (b.side ?? "top")
}
