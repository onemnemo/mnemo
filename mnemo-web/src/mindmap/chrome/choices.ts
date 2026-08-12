/**
 * The values each style control offers, and the order it offers them in.
 *
 * One table per field, read by everything that sets that field. The flyout that arms a stroke before
 * it is drawn and the bar that restyles a finished one have to show the same values in the same
 * order, or the same map ends up styled out of two vocabularies depending on which control happened
 * to be nearer.
 */

import type { ArrowCap, EdgeRouting, FontScale, LineStyle, NodeShape } from "../model/document"

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
