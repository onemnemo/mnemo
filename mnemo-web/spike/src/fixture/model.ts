/**
 * The Mindmap element model, mirrored from `Mnemo.Core.Models.Mindmap` closely enough
 * that a fixture built here is a document the real service would accept.
 *
 * Only the fields the renderer actually reads are carried. Revision, timestamps and the
 * library metadata that lives outside the document are all absent on purpose: the spike
 * measures rendering, and carrying fields no arm reads would invite an arm to be judged
 * on plumbing it never had to do.
 *
 * Positions are absolute canvas coordinates for EVERY element kind, including frame
 * members. That is the fact that makes React Flow's parent-relative grouping model a bad
 * fit, so it is stated here rather than discovered later.
 */

export type ElementKind = 'node' | 'shape' | 'text' | 'image' | 'frame'

/** Node content kinds. Ref kinds are split out because each draws a different glyph. */
export type NodeContentKind = 'text' | 'task' | 'code' | 'math' | 'link' | 'note' | 'flashcard'

export type ShapeType =
  | 'rectangle'
  | 'ellipse'
  | 'diamond'
  | 'hexagon'
  | 'parallelogram'
  | 'line'
  | 'arrow'

export interface TextContent {
  readonly kind: 'text'
  readonly text: string
}

export interface TaskContent {
  readonly kind: 'task'
  readonly text: string
  readonly done: boolean
}

export interface CodeContent {
  readonly kind: 'code'
  readonly language: string
  readonly source: string
}

export interface MathContent {
  readonly kind: 'math'
  readonly latex: string
}

export interface LinkContent {
  readonly kind: 'link'
  readonly url: string
  readonly title: string
}

/** A live reference to a note or a deck. The badge is what makes these the most chrome-heavy node. */
export interface RefContent {
  readonly kind: 'note' | 'flashcard'
  readonly targetId: string
  readonly title: string
  /** Rendered as a right-edge chip, e.g. "12 due". Absent for note refs. */
  readonly badge?: string
  /** Drawn muted-italic when the target is confirmed gone. */
  readonly missing?: boolean
}

export interface ShapeContent {
  readonly kind: 'shape'
  readonly shape: ShapeType
  readonly text?: string
}

export interface FreeTextContent {
  readonly kind: 'freeText'
  readonly text: string
}

export interface CanvasImageContent {
  readonly kind: 'image'
  /** File name only, matching the desktop's package-portability rule. */
  readonly assetId: string
}

/**
 * Membership is an explicit id list, freely edited, never derived from geometry or from
 * the hierarchy. Frames may not contain frames.
 */
export interface FrameContent {
  readonly kind: 'frame'
  readonly title: string
  readonly childIds: readonly string[]
}

export type ElementContent =
  | TextContent
  | TaskContent
  | CodeContent
  | MathContent
  | LinkContent
  | RefContent
  | ShapeContent
  | FreeTextContent
  | CanvasImageContent
  | FrameContent

export interface MindmapElement {
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
  /** A colour token name or a raw #RRGGBB literal, matching the desktop's cascade. */
  readonly fill?: string
  readonly stroke?: string
}

export type EdgeKind = 'hierarchy' | 'link'
export type EdgeRouting = 'straight' | 'curve' | 'orthogonal'
export type EdgeLineStyle = 'solid' | 'dashed' | 'dotted' | 'double'

export interface MindmapEdge {
  readonly id: string
  readonly fromId: string
  readonly toId: string
  readonly kind: EdgeKind
  readonly label?: string
  /** Link edges only. Hierarchy edges are always a plain centre-to-centre bezier. */
  readonly routing?: EdgeRouting
  readonly lineStyle?: EdgeLineStyle
  readonly thickness?: number
  readonly color?: string
  readonly startCap?: 'none' | 'arrow' | 'dot'
  readonly endCap?: 'none' | 'arrow' | 'dot'
}

export interface MindmapFixture {
  readonly id: string
  readonly layout: FixtureLayout
  readonly elements: readonly MindmapElement[]
  readonly edges: readonly MindmapEdge[]
  /** Cluster root ids, in creation order. */
  readonly clusterRoots: readonly string[]
  /** Hierarchy parent for every tree node, for relayout and group operations. */
  readonly parentOf: Readonly<Record<string, string>>
  readonly bounds: Bounds
  /**
   * A content digest over the generated document. Two engines must build byte-identical
   * fixtures or nothing measured on them is comparable, so this is asserted, not assumed.
   */
  readonly digest: string
}

export type FixtureLayout = 'forest' | 'dense-grid'

export interface Bounds {
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
}

export function boundsOf(elements: readonly MindmapElement[]): Bounds {
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
 * The zoom at which `bounds` fits `viewport` with a margin, clamped to the camera's own
 * limits. MinScale 0.1 and MaxScale 5.0 are the shipped desktop's values; a fixture whose
 * natural fit zoom falls below the floor is one the product cannot display in full, and
 * the spike needs to know that rather than silently measure an unreachable state.
 */
export const MIN_SCALE = 0.1
export const MAX_SCALE = 5.0

export function fitZoom(
  bounds: Bounds,
  viewportWidth: number,
  viewportHeight: number,
  margin = 0.05,
): { zoom: number; clampedToFloor: boolean } {
  const w = bounds.maxX - bounds.minX
  const h = bounds.maxY - bounds.minY
  const raw = Math.min(
    (viewportWidth * (1 - margin)) / w,
    (viewportHeight * (1 - margin)) / h,
  )
  return {
    zoom: Math.min(MAX_SCALE, Math.max(MIN_SCALE, raw)),
    clampedToFloor: raw < MIN_SCALE,
  }
}
