/**
 * Edge geometry.
 *
 * The spike's version of this file anchored every edge to the source's right side and the target's
 * left side, because it was reproducing what React Flow draws so the two arms could be compared
 * fairly. That is the wrong geometry for a mindmap: a balanced map runs branches out both ways from
 * the root, and half of them would leave the wrong side of their parent and arrive at the wrong side
 * of their child. The structure of the module carries over unchanged; the math does not.
 *
 * Everything here is pure and returns numbers rather than an SVG `d` string. Both edge substrates
 * have to draw the same curve, and the only way to be certain of that is for both to come out of
 * here. Parsing a `d` string back into numbers at draw time would put a string parser inside the
 * per-frame path of the one thing whose per-frame cost is the whole architecture.
 */

import type { EdgeRouting, SceneElement } from '../model/scene'
import type { Point } from '../model/scene'

/**
 * How far a curve's control points reach along the chord, as a fraction.
 *
 * 0 is a dead straight line and 1 pushes each control point all the way onto the other end's
 * coordinate. 0.85 is round enough to read as growth without the S-bend that a full 1 gives on a
 * short hop.
 */
const CURVE = 0.85

/** Corner radius on an elbow, clamped on short runs so a stub does not curl into a hook. */
const ELBOW = 8

/**
 * How dominant the horizontal offset must be before an edge attaches sideways.
 *
 * The horizontal offset is discounted by this before being compared, so sideways attachment needs
 * the horizontal gap to beat the vertical one by about a third rather than merely to exceed it. A
 * diagonal child therefore sprouts from its parent's underside rather than its flank, which is what
 * makes a fanned branch read as growing outward instead of as a bundle of near-45-degree wires.
 * Taken from the design; the exact number is what keeps a row of children attaching alike.
 */
const HORIZONTAL_BIAS = 0.75

export interface ElementBox {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  /**
   * Where on this box an edge should land, when that is not simply the edge of the box.
   *
   * A plain node is text with a coloured rule under it and almost no padding; its rule IS its
   * connection point, and a branch that stops at the invisible top of its text box instead reads as
   * a gap between the line and the word. `underline` is that rule's thickness, and its presence is
   * what marks the box as a plain node.
   */
  readonly underline?: number
}

/** Where a cap sits and which way it points, in canvas coordinates. */
export interface CapPlacement {
  readonly x: number
  readonly y: number
  /** Radians, pointing the way the line is travelling at that end. */
  readonly angle: number
}

/**
 * The two ends of a stroke, with the direction the line is actually going when it gets there.
 *
 * From the curve rather than from the chord: an arrowhead aligned to the straight line between two
 * boxes points visibly wrong on anything but a straight edge, and every default routing here is a
 * curve. The start cap points backwards along the line, which is what makes an arrow at the start
 * read as pointing away from the node it touches.
 */
export function capsOf(stroke: EdgeStroke): { start: CapPlacement; end: CapPlacement } | null {
  if (stroke.kind === 'cubic') {
    return {
      start: { x: stroke.sx, y: stroke.sy, angle: Math.atan2(stroke.sy - stroke.c1y, stroke.sx - stroke.c1x) },
      end: { x: stroke.tx, y: stroke.ty, angle: Math.atan2(stroke.ty - stroke.c2y, stroke.tx - stroke.c2x) },
    }
  }

  if (stroke.kind === 'polyline') {
    return capsOfPoints(stroke.points)
  }

  // A cap sits on the line the rails were offset from, not on either rail, or a double line would
  // arrive at its node with two arrowheads side by side.
  if (stroke.kind === 'rails') {
    return capsOfPoints(centreOf(stroke.rails))
  }

  // A ribbon is a filled shape whose ends are already its own statement about direction.
  return null
}

function capsOfPoints(points: readonly Point[]): { start: CapPlacement; end: CapPlacement } | null {
  if (points.length < 2) return null
  const [s0, s1] = [points[0], points[1]]
  const [t1, t0] = [points[points.length - 2], points[points.length - 1]]
  return {
    start: { x: s0.x, y: s0.y, angle: Math.atan2(s0.y - s1.y, s0.x - s1.x) },
    end: { x: t0.x, y: t0.y, angle: Math.atan2(t0.y - t1.y, t0.x - t1.x) },
  }
}

/** The line a set of rails were offset from, recovered by averaging them sample for sample. */
function centreOf(rails: readonly (readonly Point[])[]): readonly Point[] {
  if (rails.length === 0) return []
  const length = rails[0].length
  const centre: Point[] = []
  for (let i = 0; i < length; i++) {
    let x = 0
    let y = 0
    for (const rail of rails) {
      x += rail[i].x
      y += rail[i].y
    }
    centre.push({ x: x / rails.length, y: y / rails.length })
  }
  return centre
}

export function boxOf(element: SceneElement): ElementBox {
  return {
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
    underline: element.underline,
  }
}

export interface Anchors {
  readonly sx: number
  readonly sy: number
  readonly tx: number
  readonly ty: number
  /** Which way the edge leaves and arrives. Control points are offset along this axis. */
  readonly axis: 'x' | 'y'
  /** +1 when the target is to the right of, or below, the source. */
  readonly sign: 1 | -1
}

/**
 * The y at which an edge should meet this box.
 *
 * For anything but a plain node this is the box's own mid-height (or the passed default). For a
 * plain node it is the rule under the text, on **both** axes. Applying it only when the edge comes
 * in sideways was the original bug: a child sitting mostly above or below its parent took the other
 * branch, landed on the flat top or bottom of a near-invisible text box, and left a visible seam
 * between the branch and the word it feeds. The default template draws plain nodes, so that was the
 * default experience rather than an edge case.
 */
function meetY(box: ElementBox, fallback: number): number {
  return box.underline === undefined ? fallback : box.y + box.height - box.underline / 2
}

/**
 * Where an edge leaves one box and meets another.
 *
 * The side is chosen from the offset between box centres, with a bias toward horizontal, and both
 * ends always use the same axis: an edge that leaves sideways and arrives from above is not a curve,
 * it is a corner nobody asked for.
 */
export function anchorsFor(source: ElementBox, target: ElementBox): Anchors {
  const scx = source.x + source.width / 2
  const scy = source.y + source.height / 2
  const tcx = target.x + target.width / 2
  const tcy = target.y + target.height / 2
  const dx = tcx - scx
  const dy = tcy - scy

  if (Math.abs(dx) * HORIZONTAL_BIAS >= Math.abs(dy)) {
    const sign: 1 | -1 = dx >= 0 ? 1 : -1
    return {
      sx: sign > 0 ? source.x + source.width : source.x,
      sy: meetY(source, scy),
      tx: sign > 0 ? target.x : target.x + target.width,
      ty: meetY(target, tcy),
      axis: 'x',
      sign,
    }
  }

  const sign: 1 | -1 = dy >= 0 ? 1 : -1
  return {
    sx: scx,
    sy: meetY(source, sign > 0 ? source.y + source.height : source.y),
    tx: tcx,
    ty: meetY(target, sign > 0 ? target.y : target.y + target.height),
    axis: 'y',
    sign,
  }
}

/**
 * An edge's stroke as numbers rather than as an SVG `d` string.
 *
 * `ribbon` is a filled shape rather than a stroked one: two cubics and two straight caps, closed.
 * It is the mindmap's own material, thick where it leaves the parent and thin where it meets the
 * child, and it cannot be expressed as a stroke because a stroke has one width.
 */
export type EdgeStroke =
  | {
      readonly kind: 'cubic'
      readonly sx: number
      readonly sy: number
      readonly c1x: number
      readonly c1y: number
      readonly c2x: number
      readonly c2y: number
      readonly tx: number
      readonly ty: number
    }
  | { readonly kind: 'polyline'; readonly points: readonly Point[] }
  /**
   * One line drawn as several running alongside each other. A double line is two of these.
   *
   * Held as flattened points rather than as offset curves because a cubic has no exact parallel: the
   * offset of a bezier is not a bezier, and every closed form for it is an approximation that goes
   * wrong exactly where a mindmap's branches turn hardest.
   */
  | { readonly kind: 'rails'; readonly rails: readonly (readonly Point[])[] }
  | {
      readonly kind: 'ribbon'
      /** Outward edge, source to target. */
      readonly outbound: readonly [Point, Point, Point, Point]
      /** Return edge, target back to source, closing the shape. */
      readonly inbound: readonly [Point, Point, Point, Point]
    }

export interface EdgeShape {
  readonly stroke: EdgeStroke
  readonly label: Point
}

/** Control points for a cubic between two anchors, offset along the attachment axis. */
function controls(a: Anchors, curve: number): [Point, Point] {
  const k = 0.5 * curve
  if (a.axis === 'x') {
    const d = (a.tx - a.sx) * k
    return [
      { x: a.sx + d, y: a.sy },
      { x: a.tx - d, y: a.ty },
    ]
  }
  const d = (a.ty - a.sy) * k
  return [
    { x: a.sx, y: a.sy + d },
    { x: a.tx, y: a.ty - d },
  ]
}

/** The cubic at t = 0.5, which is where a label sits so it does not drift off a curved edge. */
function cubicMidpoint(a: Anchors, c1: Point, c2: Point): Point {
  return {
    x: (a.sx + 3 * c1.x + 3 * c2.x + a.tx) / 8,
    y: (a.sy + 3 * c1.y + 3 * c2.y + a.ty) / 8,
  }
}

function curved(a: Anchors, curve: number): EdgeShape {
  const [c1, c2] = controls(a, curve)
  return {
    stroke: {
      kind: 'cubic',
      sx: a.sx,
      sy: a.sy,
      c1x: c1.x,
      c1y: c1.y,
      c2x: c2.x,
      c2y: c2.y,
      tx: a.tx,
      ty: a.ty,
    },
    label: cubicMidpoint(a, c1, c2),
  }
}

function straight(a: Anchors): EdgeShape {
  return {
    stroke: {
      kind: 'polyline',
      points: [
        { x: a.sx, y: a.sy },
        { x: a.tx, y: a.ty },
      ],
    },
    label: { x: (a.sx + a.tx) / 2, y: (a.sy + a.ty) / 2 },
  }
}

/**
 * Two right-angle turns through the midpoint of the attachment axis.
 *
 * Every child that shares its parent's attachment axis therefore shares one spine, which is what
 * makes a tree of elbows read as an org chart rather than as a bundle of separate wires.
 */
function orthogonal(a: Anchors): EdgeShape {
  const horizontal = a.axis === 'x'
  const mid = horizontal ? (a.sx + a.tx) / 2 : (a.sy + a.ty) / 2

  // Already square on: a bend here would be a wiggle, not a corner.
  if (horizontal ? Math.abs(a.sy - a.ty) < 0.5 : Math.abs(a.sx - a.tx) < 0.5) {
    return straight(a)
  }

  const points: Point[] = horizontal
    ? [
        { x: a.sx, y: a.sy },
        { x: mid, y: a.sy },
        { x: mid, y: a.ty },
        { x: a.tx, y: a.ty },
      ]
    : [
        { x: a.sx, y: a.sy },
        { x: a.sx, y: mid },
        { x: a.tx, y: mid },
        { x: a.tx, y: a.ty },
      ]

  return {
    stroke: { kind: 'polyline', points },
    label: horizontal ? { x: mid, y: (a.sy + a.ty) / 2 } : { x: (a.sx + a.tx) / 2, y: mid },
  }
}

/**
 * A tapering ribbon: the curve widened to `fromWidth` at the source and `toWidth` at the target.
 *
 * Built from the same control points as the plain curve, each pushed out along the perpendicular by
 * that end's half width, so a ribbon and a stroke between the same two boxes follow the same line.
 */
function ribbon(a: Anchors, fromWidth: number, toWidth: number, curve: number): EdgeShape {
  const [c1, c2] = controls(a, curve)
  // Perpendicular to the attachment axis: a sideways edge thickens vertically and vice versa.
  const nx = a.axis === 'x' ? 0 : 1
  const ny = a.axis === 'x' ? 1 : 0
  const push = (p: Point, w: number): Point => ({ x: p.x + (nx * w) / 2, y: p.y + (ny * w) / 2 })

  const start = { x: a.sx, y: a.sy }
  const end = { x: a.tx, y: a.ty }

  return {
    stroke: {
      kind: 'ribbon',
      outbound: [push(start, fromWidth), push(c1, fromWidth), push(c2, toWidth), push(end, toWidth)],
      inbound: [push(end, -toWidth), push(c2, -toWidth), push(c1, -fromWidth), push(start, -fromWidth)],
    },
    label: cubicMidpoint(a, c1, c2),
  }
}

export function edgeShape(routing: EdgeRouting, a: Anchors): EdgeShape {
  if (routing === 'straight') return straight(a)
  if (routing === 'orthogonal') return orthogonal(a)
  return curved(a, CURVE)
}

/**
 * The shape for a hierarchy edge, which is the one place a tapering ribbon is drawn.
 *
 * A ribbon follows whatever route the edge carries, so "curved and tapering" and "elbowed and
 * tapering" are both sayable. An elbow cannot taper without looking broken at the corner, so it
 * holds one weight and lets the corner do the work.
 */
export function branchShape(
  routing: EdgeRouting,
  a: Anchors,
  fromWidth: number,
  toWidth: number,
): EdgeShape {
  if (routing === 'orthogonal' || Math.abs(fromWidth - toWidth) < 0.01) {
    return edgeShape(routing, a)
  }
  if (routing === 'straight') {
    return ribbon(a, fromWidth, toWidth, 0)
  }
  return ribbon(a, fromWidth, toWidth, CURVE)
}

/** The stroke as SVG path data. The one place a `d` string is ever produced. */
export function strokeToPathData(stroke: EdgeStroke): string {
  if (stroke.kind === 'cubic') {
    return (
      `M${stroke.sx},${stroke.sy} ` +
      `C${stroke.c1x},${stroke.c1y} ${stroke.c2x},${stroke.c2y} ${stroke.tx},${stroke.ty}`
    )
  }

  if (stroke.kind === 'ribbon') {
    const [o0, o1, o2, o3] = stroke.outbound
    const [i0, i1, i2, i3] = stroke.inbound
    return (
      `M${o0.x},${o0.y} C${o1.x},${o1.y} ${o2.x},${o2.y} ${o3.x},${o3.y} ` +
      `L${i0.x},${i0.y} C${i1.x},${i1.y} ${i2.x},${i2.y} ${i3.x},${i3.y} Z`
    )
  }

  // One path element with a subpath per rail, rather than a path element each: an edge owns one node
  // in the SVG layer and the culler hides that node, so a second one would be a second thing to keep
  // in step with it for no gain.
  if (stroke.kind === 'rails') {
    return stroke.rails.map(polylineData).join(' ')
  }

  return polylineData(stroke.points)
}

function polylineData(points: readonly Point[]): string {
  const [first, ...rest] = points
  return `M${first.x},${first.y}` + rest.map((p) => ` L${p.x},${p.y}`).join('')
}

/** True when the shape has to be filled rather than stroked. */
export function isFilled(stroke: EdgeStroke): boolean {
  return stroke.kind === 'ribbon'
}

/**
 * Samples along a curve when it has to become points. Enough that the offset below reads as a smooth
 * line at the zoom anyone reads a map at, and few enough that a document of them is still cheap.
 */
const RAIL_SAMPLES = 28

/**
 * The same line drawn as two, offset either side of where it ran.
 *
 * This is what a double line actually is, and the port had been resolving it to a plain one because
 * neither substrate could draw it. Faking it with a dense dash was the alternative and it reads as a
 * third dash style rather than as the thing it is named after.
 *
 * A ribbon comes back untouched: it is a filled taper, which already says everything a doubled
 * outline would, and doubling it would draw a shape with a hole in it.
 */
export function railsFor(stroke: EdgeStroke, separation: number): EdgeStroke {
  if (stroke.kind === 'ribbon' || stroke.kind === 'rails') {
    return stroke
  }

  const centre = stroke.kind === 'cubic' ? sampleCubic(stroke, RAIL_SAMPLES) : stroke.points
  if (centre.length < 2) {
    return stroke
  }

  const half = separation / 2
  return { kind: 'rails', rails: [offsetBy(centre, half), offsetBy(centre, -half)] }
}

function sampleCubic(
  stroke: Extract<EdgeStroke, { kind: 'cubic' }>,
  samples: number,
): readonly Point[] {
  const points: Point[] = []
  for (let i = 0; i <= samples; i++) {
    const t = i / samples
    const u = 1 - t
    const a = u * u * u
    const b = 3 * u * u * t
    const c = 3 * u * t * t
    const d = t * t * t
    points.push({
      x: a * stroke.sx + b * stroke.c1x + c * stroke.c2x + d * stroke.tx,
      y: a * stroke.sy + b * stroke.c1y + c * stroke.c2y + d * stroke.ty,
    })
  }
  return points
}

/**
 * Every point pushed sideways by the same distance, along the normal of the line through it.
 *
 * The normal at an interior point comes from its neighbours rather than from the segment before it,
 * so the two rails stay the same distance apart around a corner instead of pinching on the inside of
 * it. Degenerate segments, where two samples land on the same spot, keep the last usable normal.
 */
function offsetBy(points: readonly Point[], distance: number): readonly Point[] {
  const out: Point[] = []
  let nx = 0
  let ny = 0

  for (let i = 0; i < points.length; i++) {
    const before = points[Math.max(0, i - 1)]
    const after = points[Math.min(points.length - 1, i + 1)]
    const dx = after.x - before.x
    const dy = after.y - before.y
    const length = Math.hypot(dx, dy)
    if (length > 1e-6) {
      nx = -dy / length
      ny = dx / length
    }
    out.push({ x: points[i].x + nx * distance, y: points[i].y + ny * distance })
  }

  return out
}

export interface EdgeGeometry {
  readonly path: string
  readonly label: Point
}

export function edgeGeometry(routing: EdgeRouting, a: Anchors): EdgeGeometry {
  const shape = edgeShape(routing, a)
  return { path: strokeToPathData(shape.stroke), label: shape.label }
}

/** Exposed for the elbow's corner rounding, which the SVG renderer applies at draw time. */
export const ELBOW_RADIUS = ELBOW
