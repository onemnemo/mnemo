/**
 * How an edge is stroked, and which substrate strokes it.
 *
 * Both edge modes read these numbers from here rather than each keeping a copy. The canvas mode
 * exists only to be compared against the SVG one, and a comparison between two renderers drawing
 * visibly different edges measures nothing but the difference between them.
 */

import type { SceneEdge } from '../model/scene'

/**
 * Which substrate draws the strokes.
 *
 * Labels stay DOM in every mode that draws edges at all. Canvas text is laid out and rasterised
 * by a different path than DOM text, with different metrics, hinting and subpixel behaviour, so
 * moving the labels too would change what is on screen and leave the two modes incomparable on
 * the one thing being measured.
 */
export type EdgeMode = 'svg' | 'canvas' | 'off'

const HIERARCHY_COLOR = '#4a5162'
const HIERARCHY_WIDTH = 1.25
const LINK_COLOR = '#7b869c'
const LINK_WIDTH = 1.5

/**
 * Dash patterns in canvas units, shared instances so a renderer can tell "same dash as the last
 * edge" by identity instead of comparing arrays on every edge of every frame.
 *
 * Shared instances so a renderer can tell "same dash as the last edge" by identity instead of
 * comparing arrays on every edge of every frame.
 */
const DASHED: number[] = [6, 4]
const DOTTED: number[] = [1, 4]

const DASH_BY_STYLE: Record<string, number[] | null> = {
  solid: null,
  dashed: DASHED,
  dotted: DOTTED,
  // A double line is two continuous strokes, so it has no dash of its own. It is geometry rather
  // than a stroke pattern and is built where the rest of the shape is, in strokeFor.
  double: null,
}

export interface EdgeStrokeStyle {
  readonly color: string
  readonly width: number
  /** Null for a continuous line. */
  readonly dash: number[] | null
}

/** Hierarchy edges are all identical, so they share one object rather than allocating per edge. */
const HIERARCHY_STYLE: EdgeStrokeStyle = {
  color: HIERARCHY_COLOR,
  width: HIERARCHY_WIDTH,
  dash: null,
}

export function strokeStyleFor(edge: SceneEdge): EdgeStrokeStyle {
  const hierarchy = edge.kind === 'hierarchy'
  const color = edge.color ?? (hierarchy ? HIERARCHY_COLOR : LINK_COLOR)
  const width = edge.thickness ?? (hierarchy ? HIERARCHY_WIDTH : LINK_WIDTH)
  const dash = DASH_BY_STYLE[edge.lineStyle ?? 'solid'] ?? null

  // The shared object is an allocation win worth keeping for the common case, but only for the common
  // case. Branch colour is the mindmap's signature, and returning the singleton for a branch that
  // resolved to one would discard it: every branch would draw the same slate grey however the cascade
  // came out, which is the one thing a coloured map cannot survive. Keyed on the resolved values
  // rather than on which fields were named, so a projector that writes out an edge's style in full
  // still takes the fast path when that style is the ordinary one.
  if (hierarchy && color === HIERARCHY_COLOR && width === HIERARCHY_WIDTH && dash === null) {
    return HIERARCHY_STYLE
  }

  return { color, width, dash }
}

/** The same dash as an SVG `stroke-dasharray`, undefined when the line is continuous. */
export function dashAttribute(dash: number[] | null): string | undefined {
  return dash ? dash.join(' ') : undefined
}
