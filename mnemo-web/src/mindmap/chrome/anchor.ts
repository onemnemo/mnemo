/**
 * Where a floating bar goes, as arithmetic.
 *
 * Separate from the bars themselves because placement is the part with edges: a bar hanging over a
 * node near the top of the pane, a bar over an edge running off the left, a bar that would land on
 * the dock. Those are cheap to test as numbers and expensive to test by dragging a map around.
 *
 * Everything here works in pane pixels except the two anchor pickers, which answer in canvas
 * coordinates and leave the conversion to the camera, since the camera is the only thing that knows
 * where it is looking.
 */

import { anchorsFor, edgeShape, type ElementBox } from "../canvas/edge-paths"
import type { EdgeRouting, Point } from "../model/scene"

/** Gap between the thing the bar is about and the bar's own bottom edge. */
export const BAR_LIFT = 14

/** Breathing room at the pane's top edge, added to the bar's own height. */
export const BAR_GAP = 8

/**
 * How much of the pane's bottom the dock owns.
 *
 * The dock sits at 16px with a 40px height, so it occupies the last 56; the extra 8 keeps a bar
 * pushed down there from touching it.
 */
export const BAR_DOCK_CLEARANCE = 64

/** Air between a control and the panel it opens. Matches the offset the panel renders with. */
export const FLYOUT_GAP = 7

/** How near the edge of its bounds a panel may come before that side counts as too small. */
export const FLYOUT_EDGE = 8

export interface Size {
  readonly width: number
  readonly height: number
}

/** Just the two edges a flip is decided by, so callers can pass a DOMRect or a plain object. */
export interface Span {
  readonly top: number
  readonly bottom: number
}

/**
 * Which side of its control a flyout opens on.
 *
 * Above by preference. Every one of these hangs off a floating bar, and a bar sits over the thing it
 * is about, so a panel below it covers exactly what the panel is for. Above stops being available
 * near the top of the pane, where the bar is already clamped against the edge and a panel over it
 * would be behind the header rather than on screen.
 *
 * Neither side fitting is a short window, not a bug, and then the roomier side wins so the panel
 * loses as little of itself as it can.
 */
export function flyoutSide(control: Span, bounds: Span, panelHeight: number): "above" | "below" {
  const above = control.top - bounds.top
  if (above >= panelHeight + FLYOUT_GAP + FLYOUT_EDGE) {
    return "above"
  }
  return bounds.bottom - control.bottom > above ? "below" : "above"
}

/**
 * The bar's bottom-centre, kept inside the pane.
 *
 * Bottom-centre rather than top-left because the bar grows upward and sideways from the thing it is
 * about, so that is the corner that has to stay put when the bar's own width changes.
 *
 * The floors win over the ceilings on purpose. A pane shorter than the bar has no position that
 * satisfies both, and a bar pinned to the top edge is readable where one pinned below the bottom is
 * gone entirely.
 */
export function clampBar(at: Point, bar: Size, pane: Size): Point {
  const half = bar.width / 2 + BAR_GAP
  const top = bar.height + BAR_GAP
  return {
    x: clamp(at.x, half, Math.max(half, pane.width - half)),
    y: clamp(at.y - BAR_LIFT, top, Math.max(top, pane.height - BAR_DOCK_CLEARANCE)),
  }
}

/**
 * The point an edge's bar hangs over: the same one its label already sits at.
 *
 * Through the shape rather than by averaging the two boxes, even though the three routings happen to
 * agree on that point today. They agree because a symmetric cubic's midpoint and an elbow's bend
 * both land on the mean of the anchors, which is a property of the current geometry rather than a
 * promise. Asking the shape means the bar and the label it floats over cannot come apart if that
 * ever changes.
 */
export function edgeAnchor(routing: EdgeRouting, from: ElementBox, to: ElementBox): Point {
  return edgeShape(routing, anchorsFor(from, to)).label
}

export interface FrameInput {
  /** Where the bar wants to be, in canvas coordinates, or null when there is nothing to sit over. */
  readonly world: Point | null
  readonly toPane: (point: Point) => Point
  /**
   * The two sizes the clamp needs.
   *
   * A thunk rather than two values because reading either one is a layout read, and the great
   * majority of frames are frames where nothing moved. Not calling this is the whole idle cost of
   * following a map that is sitting still.
   */
  readonly measure: () => { readonly bar: Size; readonly pane: Size }
  /** Where the anchor landed last time, in pane pixels. Null before the first placement. */
  readonly last: Point | null
}

/**
 * One frame's decision.
 *
 * Null means write nothing: either there is nothing to sit over, or the anchor has not moved since
 * the last write. `anchor` is the unclamped pane point, which is what the next frame compares
 * against; `at` is where the bar actually goes.
 */
export function nextPlacement(input: FrameInput): { anchor: Point; at: Point } | null {
  if (!input.world) {
    return null
  }
  const anchor = input.toPane(input.world)
  if (input.last && anchor.x === input.last.x && anchor.y === input.last.y) {
    return null
  }
  const { bar, pane } = input.measure()
  return { anchor, at: clampBar(anchor, bar, pane) }
}

/** The point a node bar hangs over: the top edge of everything selected, centred. */
export function boxesAnchor(boxes: readonly ElementBox[]): Point | null {
  if (boxes.length === 0) {
    return null
  }
  let left = Infinity
  let right = -Infinity
  let top = Infinity
  for (const box of boxes) {
    if (box.x < left) left = box.x
    if (box.x + box.width > right) right = box.x + box.width
    if (box.y < top) top = box.y
  }
  return { x: (left + right) / 2, y: top }
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value
}
