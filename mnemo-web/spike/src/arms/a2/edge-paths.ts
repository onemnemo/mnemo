/**
 * Edge geometry for the hand-rolled arm.
 *
 * Deliberately reproduces what React Flow draws rather than something cheaper. A1 anchors every
 * edge to a right-side source handle and a left-side target handle and renders a cubic bezier
 * with React Flow's own curvature, and A2 has to draw the same curve through the same points:
 * an arm that draws a straight line where the other drew a bezier is not faster, it is
 * incomplete, and a straw-man arm is the likeliest way this spike produces a confident wrong
 * answer.
 *
 * The three link routings are all here for the same reason. Mnemo's link edges carry a routing,
 * a line style, a thickness, a colour and a label, and an arm that renders fewer decorations
 * than the product is measuring a product that will never ship.
 */

import type { EdgeRouting, MindmapElement } from '../../fixture/model'
import type { Point } from '../../harness/contract'

/** React Flow's default bezier curvature, so the two arms draw the same curve. */
const CURVATURE = 0.25

export interface EdgeGeometry {
  readonly path: string
  /** Where a link edge's label sits. Unused for hierarchy edges, which carry none. */
  readonly label: Point
}

export interface Anchors {
  readonly sx: number
  readonly sy: number
  readonly tx: number
  readonly ty: number
}

/** Right edge of the source, left edge of the target, both at mid-height. */
export function anchorsFor(source: ElementBox, target: ElementBox): Anchors {
  return {
    sx: source.x + source.width,
    sy: source.y + source.height / 2,
    tx: target.x,
    ty: target.y + target.height / 2,
  }
}

export interface ElementBox {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export function boxOf(element: MindmapElement): ElementBox {
  return { x: element.x, y: element.y, width: element.width, height: element.height }
}

/**
 * React Flow's control-point offset: half the horizontal gap when the target is to the right,
 * and a square-root falloff when the edge doubles back, which is what stops a backwards edge
 * from ballooning into an enormous loop.
 */
function controlOffset(distance: number): number {
  return distance >= 0 ? 0.5 * distance : CURVATURE * 25 * Math.sqrt(-distance)
}

function bezier(a: Anchors): EdgeGeometry {
  const offset = controlOffset(a.tx - a.sx)
  const c1x = a.sx + offset
  const c2x = a.tx - offset
  return {
    path: `M${a.sx},${a.sy} C${c1x},${a.sy} ${c2x},${a.ty} ${a.tx},${a.ty}`,
    // The cubic evaluated at t = 0.5, which is where React Flow puts its own edge label.
    label: {
      x: 0.125 * a.sx + 0.375 * c1x + 0.375 * c2x + 0.125 * a.tx,
      y: 0.5 * a.sy + 0.5 * a.ty,
    },
  }
}

function straight(a: Anchors): EdgeGeometry {
  return {
    path: `M${a.sx},${a.sy} L${a.tx},${a.ty}`,
    label: { x: (a.sx + a.tx) / 2, y: (a.sy + a.ty) / 2 },
  }
}

function orthogonal(a: Anchors): EdgeGeometry {
  const midX = (a.sx + a.tx) / 2
  return {
    path: `M${a.sx},${a.sy} L${midX},${a.sy} L${midX},${a.ty} L${a.tx},${a.ty}`,
    label: { x: midX, y: (a.sy + a.ty) / 2 },
  }
}

export function edgeGeometry(routing: EdgeRouting, a: Anchors): EdgeGeometry {
  if (routing === 'straight') return straight(a)
  if (routing === 'orthogonal') return orthogonal(a)
  return bezier(a)
}
