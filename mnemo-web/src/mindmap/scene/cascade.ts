/**
 * The style cascade: element override, then each template in chain order, then the theme's own default.
 *
 * A mirror of `Mnemo.Infrastructure/Services/Mindmap/Style/MindmapStyleResolver.cs`, property for
 * property. It is a mirror rather than a call because the cascade runs for every visible element of
 * every frame, and a map is not something you ask a server about at that rate. The templates it reads
 * are still the server's, fetched once per open, so the only thing duplicated here is the resolution
 * rule and not the data it resolves against.
 *
 * Values stay tokens. Turning them into CSS is the projector's job, one step later, so a change of
 * theme vocabulary lands in one file instead of this one.
 */

import { branchToken } from "./tokens"
import type { ElementStyle, FontScale, NodeShape, StyleTemplate } from "../model/document"

export interface StyleContext {
  /** Distance from the cluster root; negative for a free element with no place in a tree. */
  readonly depth: number
  /** The depth-1 ancestor's branch slot, or negative for none. */
  readonly branchIndex: number
  readonly isRoot: boolean
}

/** A shape, a label or an image: its own style and the theme's defaults, and no template at all. */
export const FREE_CONTEXT: StyleContext = { depth: -1, branchIndex: -1, isRoot: false }

export interface ResolvedStyle {
  readonly fill: string
  readonly stroke: string
  readonly textColor: string
  readonly fontScale: FontScale
  readonly nodeShape: NodeShape
  readonly icon: string | null
  /** The branch's palette token when branch colouring is on; null otherwise. Edges reuse it. */
  readonly branchColor: string | null
}

const NO_TEMPLATES: readonly StyleTemplate[] = []

export function resolveStyle(
  own: ElementStyle | null | undefined,
  context: StyleContext,
  chain: readonly StyleTemplate[] = NO_TEMPLATES,
): ResolvedStyle {
  let fill = own?.fill ?? null
  let stroke = own?.stroke ?? null
  let textColor = own?.textColor ?? null
  let fontScale = own?.fontScale ?? null
  let nodeShape = own?.nodeShape ?? null
  let icon = own?.icon ?? null

  // Branch colour is a function of the branch index alone, so any opted-in template in the chain
  // turns it on and the rest of the chain cannot turn it back off.
  let branchColor: string | null = null
  if (context.depth >= 1 && context.branchIndex >= 0) {
    for (const template of chain) {
      if (template.branchColors === "byBranch") {
        branchColor = branchToken(context.branchIndex)
        break
      }
    }
  }

  // Template rules describe positions in a tree, so an element with no position in one is left with
  // its own style and the theme underneath it.
  if (context.depth >= 0) {
    for (const template of chain) {
      const rule = context.isRoot ? template.rootStyle : depthRuleStyle(template, context.depth)

      fill ??= rule?.fill ?? null
      textColor ??= rule?.textColor ?? null
      fontScale ??= rule?.fontScale ?? null
      nodeShape ??= rule?.nodeShape ?? null
      icon ??= rule?.icon ?? null

      // A stroke this template states outright beats the branch colour it would otherwise contribute.
      let templateStroke = rule?.stroke ?? null
      if (templateStroke === null && branchColor !== null && template.branchColors === "byBranch") {
        templateStroke = branchColor
      }
      stroke ??= templateStroke
    }
  }

  if (branchColor !== null) {
    stroke ??= branchColor
  }

  return {
    fill: fill ?? "surface",
    stroke: stroke ?? "stroke",
    textColor: textColor ?? "textPrimary",
    fontScale: fontScale ?? "m",
    nodeShape: nodeShape ?? "card",
    icon,
    branchColor,
  }
}

function depthRuleStyle(template: StyleTemplate, depth: number): ElementStyle | null {
  for (const rule of template.depthRules ?? []) {
    const min = rule.minDepth ?? 0
    if (depth >= min && (rule.maxDepth == null || depth <= rule.maxDepth)) {
      return rule.style
    }
  }
  return null
}

/**
 * The templates that apply to one cluster, most specific first.
 *
 * A cluster's own template, then the document's. The document's is always present, because a map with
 * no template is a map with no rules at all and every node would come out the same neutral card.
 */
export function templateChain(
  clusterTemplateId: string | null | undefined,
  documentTemplate: StyleTemplate,
  byId: ReadonlyMap<string, StyleTemplate>,
): readonly StyleTemplate[] {
  const cluster = clusterTemplateId ? byId.get(clusterTemplateId) : undefined
  return cluster && cluster.id !== documentTemplate.id ? [cluster, documentTemplate] : [documentTemplate]
}
