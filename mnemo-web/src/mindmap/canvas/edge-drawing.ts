import type { SceneEdge } from '../model/scene'
import { capInset, hasCap, type CapDraw } from '../scene/cap-geometry'
import { trimCubic, trimPolyline } from '../scene/stroke-trim'
import {
  anchorsFor,
  branchShape,
  capsOf,
  edgeShape,
  railsFor,
  strokeToPathData,
  type EdgeStroke,
} from './edge-paths'
import { strokeStyleFor } from './edge-style'

/** What every edge renderer draws: the stroke, already stopped short of any arrowhead, and its caps. */
export interface EdgeDrawing {
  /** Null when the heads cover the whole line, which then draws as its heads alone. */
  readonly stroke: EdgeStroke | null
  readonly caps: readonly CapDraw[]
  readonly width: number
}

const NO_CAPS: readonly CapDraw[] = []

/**
 * The shape an edge draws as, uncapped and untrimmed.
 *
 * A hierarchy edge that carries two different end weights is a tapering ribbon; everything else is
 * an ordinary stroke. The widths come from the projector rather than being derived here, so the two
 * substrates and the thumbnail all widen the same edge by the same amount.
 */
export function strokeFor(edge: SceneEdge, anchors: ReturnType<typeof anchorsFor>): EdgeStroke {
  const stroke = baseStrokeFor(edge, anchors)
  return edge.lineStyle === 'double' ? railsFor(stroke, doubleSeparation(strokeStyleFor(edge).width)) : stroke
}

/** The stroke as SVG path data, empty when there is no stroke left to draw. */
export function drawingPathData(stroke: EdgeStroke | null): string {
  return stroke ? strokeToPathData(stroke) : ''
}

export function drawingFor(edge: SceneEdge, anchors: ReturnType<typeof anchorsFor>): EdgeDrawing {
  const { stroke, caps, width } = centreDrawing(edge, anchors)
  return {
    stroke: stroke && edge.lineStyle === 'double' ? railsFor(stroke, doubleSeparation(width)) : stroke,
    caps,
    width,
  }
}

/**
 * The line an edge is drawn along, before a double line is split into rails: stopped short under any
 * arrowhead, and null when the heads cover it. A ribbon takes no caps, so it comes back whole.
 */
export function centreStrokeFor(edge: SceneEdge, anchors: ReturnType<typeof anchorsFor>): EdgeStroke | null {
  return centreDrawing(edge, anchors).stroke
}

function centreDrawing(edge: SceneEdge, anchors: ReturnType<typeof anchorsFor>): EdgeDrawing {
  const width = strokeStyleFor(edge).width
  const base = baseStrokeFor(edge, anchors)
  const caps = capsFor(base, edge)
  // Trimmed before the rails are offset, so both rails of a double line stop at the same base.
  const stroke = caps.length > 0 ? trimStroke(base, capInset(edge.startCap, width), capInset(edge.endCap, width)) : base
  return { stroke, caps, width }
}

function baseStrokeFor(edge: SceneEdge, anchors: ReturnType<typeof anchorsFor>): EdgeStroke {
  const routing = edge.routing ?? 'curve'
  return edge.fromWidth !== undefined && edge.toWidth !== undefined
    ? branchShape(routing, anchors, edge.fromWidth, edge.toWidth).stroke
    : edgeShape(routing, anchors).stroke
}

/**
 * How far apart the two lines of a double line sit, centre to centre.
 *
 * Two strokes with a gap the same weight as themselves, which is what makes it read as one doubled
 * line rather than as two lines that happen to be near each other. Scaled by the edge's own weight so
 * a thick double and a thin one look like the same idea.
 */
function doubleSeparation(width: number): number {
  return width * 2
}

function capsFor(stroke: EdgeStroke, edge: SceneEdge): readonly CapDraw[] {
  const wantsStart = hasCap(edge.startCap)
  const wantsEnd = hasCap(edge.endCap)
  if (!wantsStart && !wantsEnd) return NO_CAPS

  const ends = capsOf(stroke)
  if (!ends) return NO_CAPS

  const caps: CapDraw[] = []
  if (hasCap(edge.startCap)) caps.push({ kind: edge.startCap, ...ends.start })
  if (hasCap(edge.endCap)) caps.push({ kind: edge.endCap, ...ends.end })
  return caps
}

/**
 * The stroke shortened at each end. Rails are trimmed through the line they are offset from, and a
 * ribbon is never capped, so both come back as they were.
 */
export function trimStroke(stroke: EdgeStroke, fromStart: number, fromEnd: number): EdgeStroke | null {
  if (stroke.kind === 'cubic') {
    const curve = trimCubic(stroke, fromStart, fromEnd)
    return curve && { kind: 'cubic', ...curve }
  }
  if (stroke.kind === 'polyline') {
    const points = trimPolyline(stroke.points, fromStart, fromEnd)
    return points && { kind: 'polyline', points }
  }
  return stroke
}
