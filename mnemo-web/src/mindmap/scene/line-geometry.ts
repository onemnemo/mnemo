/**
 * The geometry of a line or arrow shape: where its ends are, where they lock on, what its box is.
 *
 * Pure, and shared by everything that has to agree on it: the projector resolves a stored line
 * through it, the scene index re-resolves one while a target is being dragged, the gestures ask it
 * where an end would land, the export draws from it. One module, so a line drawn during a gesture
 * is the line that is committed and the line that is exported.
 *
 * Every point that is stored is relative to the element's own box. Every point handed to a caller
 * as "absolute" is in canvas space. The functions say which they take and give.
 */

import type { AnchorSide, ArrowCap, LineAttachment, ShapeContent, ShapeType } from "../model/document"
import { pointOf } from "../model/document"
import type { Bounds, Point, SceneLine } from "../model/scene"

export interface Box {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** A possible target for an end: its box and, for a turned shape, its rotation. */
export interface AnchorTarget {
  readonly id: string
  readonly box: Box
  readonly rotation?: number
}

/** An end resolved against a target, with the point the anchor sits at. */
export interface AnchorHit {
  readonly elementId: string
  readonly side: AnchorSide
  readonly point: Point
}

/** The geometry a gesture or a commit works in: absolute points, and the attachments as stored. */
export interface AbsoluteLine {
  readonly start: Point
  readonly end: Point
  readonly bend: Point | null
  readonly startAt: LineAttachment | null
  readonly endAt: LineAttachment | null
}

/** The outline weight every shape draws at, which is what a line weighs when nothing says otherwise. */
export const DEFAULT_THICKNESS = 1.5

/**
 * How far the stored box reaches past the points on every side.
 *
 * A horizontal line would otherwise store a box of no height, and a box of no height is a host
 * with no area for its caption, an outline SVG of no size and a bounds that fit-to-view cannot fit.
 * The pad is a constant rather than a function of the stroke so that changing a line's weight
 * never moves its origin.
 */
export const LINE_PAD = 8

export const ANCHOR_SIDES: readonly AnchorSide[] = ["top", "right", "bottom", "left"]

export function isLineShape(shape: ShapeType | undefined): boolean {
  return shape === "line" || shape === "arrow"
}

/** The middle of a box's side, turned with the box when it has been rotated. */
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

/**
 * The anchor nearest a point, within a radius, over every candidate. Null when none is close.
 *
 * Every side of every candidate is measured rather than the nearest candidate's sides only, because
 * two boxes close together can each have the nearer side, and the pointer is over one of them.
 */
export function nearestAnchor(
  candidates: readonly AnchorTarget[],
  point: Point,
  radius: number,
): AnchorHit | null {
  let best: AnchorHit | null = null
  let bestDistance = radius
  for (const candidate of candidates) {
    // Every anchor lies on the box, so a point further than the radius from the box on either axis
    // cannot be within it of any anchor. Cheap enough to run against every element on a large map.
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

/**
 * Where a stored line runs, once its attached ends have been looked up.
 *
 * A row from before lines had a geometry has no `line`, and reads as the diagonal the box used to
 * draw, bottom-left to top-right, so an old map looks the way it did. A target the lookup cannot
 * find leaves the end at its stored point.
 */
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

/** The end's anchor point relative to the line's box, or undefined when it cannot be resolved. */
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

/** The line as it is stored and drawn, in canvas space. */
export function absoluteLine(line: SceneLine, box: Box): AbsoluteLine {
  return {
    start: absolute(line.start, box),
    end: absolute(line.end, box),
    bend: line.bend ? absolute(line.bend, box) : null,
    startAt: line.startAt,
    endAt: line.endAt,
  }
}

/** The stored box for a line through these absolute points: their bounds, padded. */
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

/**
 * How far past its points a stroke reaches. The cap markers are sized in stroke widths, so a heavy
 * arrow's head is wide as well as long; three widths covers the widest marker, and the constant
 * covers a hairline's own half width and the rounding of a device pixel.
 */
function overhang(thickness: number, cap: ArrowCap): number {
  return 4 + (cap === "none" ? thickness : thickness * 3)
}

/** Where the drawing is, in canvas space, for the culler and the marquee. */
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

/** The path data for a line through relative points. */
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

/** How far a point sits from the segment between two others. */
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

/**
 * The direction from one point to another, in degrees, counter clockwise from due right the way a
 * protractor reads it. The canvas has y pointing down, which is the sign flip.
 */
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

/** The end moved onto the nearest angle step about the start, keeping its distance. */
export function snapEnd(start: Point, end: Point, step = 15): Point {
  const { length, angle } = lengthAndAngle(start, end)
  const rad = (snapAngle(angle, step) * Math.PI) / 180
  return { x: start.x + length * Math.cos(rad), y: start.y - length * Math.sin(rad) }
}

/** True when writing one geometry over the other would change nothing that is stored. */
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
