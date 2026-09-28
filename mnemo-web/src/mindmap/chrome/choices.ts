/**
 * The values each style control offers, and the order it offers them in.
 *
 * One table per field, read by everything that sets that field. The flyout that arms a stroke before
 * it is drawn and the bar that restyles a finished one have to show the same values in the same
 * order, or the same map ends up styled out of two vocabularies depending on which control happened
 * to be nearer.
 */

import { HIERARCHY_WIDTH, LINK_WIDTH } from "../canvas/edge-style"
import type { AlignOp } from "../edit/align"
import type { ArrowCap, EdgeRouting, FontScale, LayoutAlgorithm, LineStyle, NodeShape } from "../model/document"
import type { SceneEdge } from "../model/scene"

export interface Choice<T> {
  value: T
  /** The translation key its name lives under. */
  key: string
}

export const LINES: readonly Choice<LineStyle>[] = [
  { value: "solid", key: "EdgeSolid" },
  { value: "dashed", key: "EdgeDashed" },
  { value: "dotted", key: "EdgeDotted" },
  { value: "double", key: "EdgeDouble" },
]

export const ROUTES: readonly Choice<EdgeRouting>[] = [
  { value: "curve", key: "RouteCurve" },
  { value: "straight", key: "RouteStraight" },
  { value: "orthogonal", key: "RouteOrthogonal" },
]

export const CAPS: readonly Choice<ArrowCap>[] = [
  { value: "none", key: "CapNone" },
  { value: "arrow", key: "CapArrow" },
  { value: "dot", key: "CapDot" },
]

/**
 * Three weights rather than a number field.
 *
 * These are the widths the renderer already draws at: 1.5 is what an unstyled link edge is, and the
 * other two are one step either side of it. A map wants a line to read as quiet, normal or emphatic,
 * and nobody has ever wanted 1.7.
 */
export const THICKNESSES: readonly Choice<number>[] = [
  { value: 1, key: "ThicknessHairline" },
  { value: 1.5, key: "ThicknessNormal" },
  { value: 2.5, key: "ThicknessBold" },
]

/** The weight a stroke is drawn at, the renderer's own default where the edge names none. */
export function weightOf(edge: SceneEdge): number {
  return edge.thickness ?? (edge.kind === "hierarchy" ? HIERARCHY_WIDTH : LINK_WIDTH)
}

export const SHAPES: readonly Choice<NodeShape>[] = [
  { value: "card", key: "ShapeCard" },
  { value: "pill", key: "ShapePill" },
  { value: "outline", key: "ShapeOutline" },
  { value: "plain", key: "ShapePlain" },
]

export const SCALES: readonly Choice<FontScale>[] = [
  { value: "s", key: "SizeSmall" },
  { value: "m", key: "SizeMedium" },
  { value: "l", key: "SizeLarge" },
  { value: "xl", key: "SizeExtraLarge" },
]

/** Layout names, in the order the algorithms are declared. */
export const LAYOUT_KEY: Readonly<Record<LayoutAlgorithm, string>> = {
  balanced: "LayoutBalanced",
  treeRight: "LayoutTreeRight",
  treeDown: "LayoutTreeDown",
  radial: "LayoutRadial",
  timeline: "LayoutTimeline",
  free: "LayoutFree",
}

/**
 * The order a hand reaches for: the three horizontal edges, the three vertical ones, then the two
 * that spread things out. The icon names read as the axis the line is drawn on, which is why
 * "start-vertical" lines left edges up.
 */
export const ALIGNS: readonly { op: AlignOp; key: string; icon: string }[] = [
  { op: "left", key: "AlignLeft", icon: "common/align-start-vertical" },
  { op: "centerHorizontal", key: "AlignCenterH", icon: "common/align-center-vertical" },
  { op: "right", key: "AlignRight", icon: "common/align-end-vertical" },
  { op: "top", key: "AlignTop", icon: "common/align-start-horizontal" },
  { op: "middleVertical", key: "AlignMiddleV", icon: "common/align-center-horizontal" },
  { op: "bottom", key: "AlignBottom", icon: "common/align-end-horizontal" },
]

export const DISTRIBUTES: readonly { op: AlignOp; key: string; icon: string }[] = [
  { op: "distributeHorizontal", key: "DistributeH", icon: "common/align-horizontal-distribute-center" },
  { op: "distributeVertical", key: "DistributeV", icon: "common/align-vertical-distribute-center" },
]
