/**
 * The scene: a document after layout and the style cascade have run.
 *
 * The stored document says what a map *is*; this says what to draw. Every field here is resolved
 * and required, where the stored equivalents are optional overrides waiting on a cascade. That
 * separation is the whole point: the renderer never asks "what colour would this be, given the
 * element's override, then the cluster template, then the document template, then the theme" while
 * it is inside a frame budget. It is asked once, by the projector, and the answer lives here.
 *
 * These types are the spike's fixture model promoted to production. The frozen substrate modules
 * (camera, culler, edge paths, scene index, drag plan) were written against exactly this shape and
 * measured against it, so keeping the shape is what carries their measured behaviour across the
 * move rather than re-deriving it.
 */

import type {
  ArrowCap,
  CanvasBackground,
  EdgeKind,
  ElementContent,
  ElementKind,
  LineStyle,
  EdgeRouting,
  NodeShape,
} from "./document"

export type { ArrowCap, CanvasBackground, EdgeKind, ElementContent, ElementKind, LineStyle, EdgeRouting, NodeShape }

/** Canvas-space coordinate at the viewport's top-left, plus the scale. Top-left origin. */
export interface Viewport {
  readonly x: number
  readonly y: number
  readonly zoom: number
}

export interface Point {
  readonly x: number
  readonly y: number
}

/**
 * Text already wrapped and already measured.
 *
 * The lines travel with the element because wrapping them is what decided the box's size. Re-wrapping
 * in the renderer would be a second implementation of the same greedy walk, free to disagree with the
 * one the layout was packed against.
 */
export interface MeasuredText {
  readonly lines: readonly string[]
  readonly fontSize: number
  readonly fontWeight: number
  readonly lineHeight: number
  readonly letterSpacing: string
}

/** One element, laid out and styled. */
export interface SceneElement {
  readonly id: string
  readonly kind: ElementKind
  readonly content: ElementContent
  /** Absolute canvas coordinates, top-left. */
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly pinned?: boolean
  readonly collapsed?: boolean
  /** Resolved to a CSS colour. The token-or-hex question is settled before this point. */
  readonly fill?: string
  readonly stroke?: string
  readonly textColor?: string
  /** Depth in the hierarchy; 0 for a root, -1 for a free element that is not in the tree at all. */
  readonly depth: number
  /** Which of the eight branch slots this element inherited, or -1 when branch colouring is off. */
  readonly branch: number
  /** How loudly it is drawn: no chrome, a tint, a card, an outline. */
  readonly nodeShape: NodeShape
  readonly text: MeasuredText
  readonly isRoot: boolean
  /** Children in the hierarchy, whether or not they are currently shown. Zero means no collapse control. */
  readonly childCount: number
  /** How many descendants a collapse is hiding; 0 when it is not collapsed. */
  readonly hiddenCount: number
  /** This element's branch colour as CSS, when branch colouring is on. */
  readonly branchColor?: string
  /**
   * The rule a plain node draws under its own text, which is also where an incoming branch has to
   * land. Absent on every other shape, which has a box to meet instead.
   */
  readonly underline?: number
  /** Icon name shown before the label. */
  readonly icon?: string
}

/**
 * One edge, routed and styled.
 *
 * The style members stay optional, unlike an element's: the renderer's own style resolver holds the
 * defaults, including the one that matters visually, that a hierarchy edge and a link edge are
 * deliberately different materials. Requiring them here would move that decision into the projector
 * and leave a second copy of it behind in the renderer.
 */
export interface SceneEdge {
  readonly id: string
  readonly fromId: string
  readonly toId: string
  readonly kind: EdgeKind
  readonly label?: string
  readonly routing?: EdgeRouting
  readonly lineStyle?: LineStyle
  readonly thickness?: number
  readonly color?: string
  readonly startCap?: ArrowCap
  readonly endCap?: ArrowCap
  /**
   * A hierarchy edge drawn as a tapering ribbon rather than a stroke, thick at the trunk and thin
   * at the twig. The stroke width at each end; both equal means a plain stroke.
   */
  readonly fromWidth?: number
  readonly toWidth?: number
}

export interface Scene {
  readonly id: string
  readonly elements: readonly SceneElement[]
  readonly edges: readonly SceneEdge[]
  readonly background: CanvasBackground
}

/* -------------------------------------------------------------------------- */
/* Bounds and fit                                                             */
/* -------------------------------------------------------------------------- */

export interface Bounds {
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
}

export function boundsOf(elements: readonly SceneElement[]): Bounds {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const e of elements) {
    if (e.x < minX) minX = e.x
    if (e.y < minY) minY = e.y
    if (e.x + e.width > maxX) maxX = e.x + e.width
    if (e.y + e.height > maxY) maxY = e.y + e.height
  }
  return { minX, minY, maxX, maxY }
}

/**
 * The camera's limits.
 *
 * The floor is 0.02 rather than the desktop's 0.1 deliberately. A tree-laid five-thousand node map
 * needs about 0.007 to fit, so the shipped desktop cannot zoom-to-fit a large map at all; it stops
 * an order of magnitude short and shows you a corner. Lowering the floor does not add a rendering
 * tier, it extends the one the level-of-detail bands already have for sub-readable elements, which
 * is the tier measured to hold sixty frames a second on five thousand of them.
 */
export const MIN_SCALE = 0.02
export const MAX_SCALE = 5.0

/**
 * The zoom at which `bounds` fits a viewport with a margin, clamped to the camera's limits.
 * `clampedToFloor` says the map is too large to show whole, which is a thing to tell the user
 * rather than to silently pretend away.
 */
export function fitZoom(
  bounds: Bounds,
  viewportWidth: number,
  viewportHeight: number,
  margin = 0.05,
): { zoom: number; clampedToFloor: boolean } {
  const w = bounds.maxX - bounds.minX
  const h = bounds.maxY - bounds.minY
  if (!(w > 0) || !(h > 0)) {
    return { zoom: 1, clampedToFloor: false }
  }

  const raw = Math.min((viewportWidth * (1 - margin)) / w, (viewportHeight * (1 - margin)) / h)
  return {
    zoom: Math.min(MAX_SCALE, Math.max(MIN_SCALE, raw)),
    clampedToFloor: raw < MIN_SCALE,
  }
}
