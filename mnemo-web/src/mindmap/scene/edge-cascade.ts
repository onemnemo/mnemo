/**
 * What an edge is made of, once every layer that has an opinion has been asked.
 *
 * Four layers, most specific first: the edge's own style, then this map's canvas defaults, then each
 * template in the cluster's chain, then what the kind means. The canvas layer sits above the templates
 * on purpose. It is the map's own choice of branch material, made from the toolbar and stored in the
 * document, and a template that also names an edge style is a shared preset the map has since
 * overruled. Below it and the choice would silently fail to stick on exactly the templates that care.
 *
 * The kind layer is the last word, and it is where a branch and a cross-link become different things:
 * a branch is structure and does not point anywhere, a cross-link is a remark about two nodes and
 * does. Everything above it can override that; nothing else defines it.
 */

import { branchWidth } from "./branch-width"
import type {
  ArrowCap,
  EdgeKind,
  EdgeRouting,
  EdgeStyle,
  EdgeWidthProfile,
  LineStyle,
  StyleTemplate,
} from "../model/document"

export interface ResolvedEdgeStyle {
  readonly line: LineStyle
  readonly widthProfile: EdgeWidthProfile
  readonly routing: EdgeRouting
  readonly startCap: ArrowCap
  readonly endCap: ArrowCap
  /** A token, or null when nothing named one and the renderer's own material stands. */
  readonly color: string | null
  readonly thickness: number | null
}

const HIERARCHY_DEFAULTS: ResolvedEdgeStyle = {
  line: "solid",
  widthProfile: "uniform",
  routing: "curve",
  startCap: "none",
  endCap: "none",
  color: null,
  thickness: null,
}

const LINK_DEFAULTS: ResolvedEdgeStyle = {
  ...HIERARCHY_DEFAULTS,
  line: "dashed",
  endCap: "arrow",
}

const NO_TEMPLATES: readonly StyleTemplate[] = []

export function resolveEdgeStyle(
  own: EdgeStyle | null | undefined,
  kind: EdgeKind,
  canvasDefaults: EdgeStyle | null | undefined,
  chain: readonly StyleTemplate[] = NO_TEMPLATES,
): ResolvedEdgeStyle {
  let line = own?.line ?? canvasDefaults?.line ?? null
  let widthProfile = own?.widthProfile ?? canvasDefaults?.widthProfile ?? null
  let routing = own?.routing ?? canvasDefaults?.routing ?? null
  let startCap = own?.startCap ?? canvasDefaults?.startCap ?? null
  let endCap = own?.endCap ?? canvasDefaults?.endCap ?? null
  let color = own?.color ?? canvasDefaults?.color ?? null
  let thickness = own?.thickness ?? canvasDefaults?.thickness ?? null

  for (const template of chain) {
    const rule = template.edgeDefaults
    if (!rule) {
      continue
    }
    line ??= rule.line ?? null
    widthProfile ??= rule.widthProfile ?? null
    routing ??= rule.routing ?? null
    startCap ??= rule.startCap ?? null
    endCap ??= rule.endCap ?? null
    color ??= rule.color ?? null
    thickness ??= rule.thickness ?? null
  }

  const base = kind === "link" ? LINK_DEFAULTS : HIERARCHY_DEFAULTS
  return {
    line: line ?? base.line,
    widthProfile: widthProfile ?? base.widthProfile,
    routing: routing ?? base.routing,
    startCap: startCap ?? base.startCap,
    endCap: endCap ?? base.endCap,
    color,
    thickness,
  }
}

export interface RibbonWidths {
  readonly fromWidth: number
  readonly toWidth: number
}

/**
 * The weights at each end of a tapering branch.
 *
 * The depth table sets the ratio; an explicit thickness renames the trunk end and the ratio carries to
 * the tip. Left to only scale the table, a thickness control would appear to do nothing on the one
 * edge style people reach for it on.
 */
export function ribbonWidths(fromDepth: number, toDepth: number, thickness: number | null): RibbonWidths {
  const from = branchWidth(fromDepth)
  const to = branchWidth(toDepth)
  const scale = thickness && from > 0 ? thickness / from : 1
  return { fromWidth: from * scale, toWidth: to * scale }
}
