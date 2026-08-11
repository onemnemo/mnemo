/**
 * A stored document becomes a drawable scene.
 *
 * This is the only place the two models meet. Everything above it draws; everything below it stores.
 * The document is full of holes on purpose, because a property nobody set is a property the cascade
 * still has to answer for, and answering it inside a frame is how a map that opens instantly starts
 * dropping frames at five thousand nodes. So it is answered once, here, and what comes out has no
 * holes left in it.
 *
 * Pure. Given the same document, templates and measurer it returns the same scene, which is what lets
 * the interesting parts be tested without a canvas, a viewport or a server.
 */

import { branchWidth } from "./branch-width"
import { FREE_CONTEXT, resolveStyle, templateChain, type StyleContext } from "./cascade"
import { resolveEdgeStyle, ribbonWidths } from "./edge-cascade"
import { analyzeHierarchy, childrenIds, hiddenDescendantCount, type Hierarchy } from "./hierarchy"
import { canvasMeasurer, measureNode, type TextMeasurer } from "./measure"
import { cssColor } from "./tokens"
import {
  contentText,
  edgeKind,
  elementKind,
  type ElementKind,
  type MindmapDocument,
  type MindmapElement,
  type StyleTemplate,
} from "../model/document"
import type { Scene, SceneEdge, SceneElement } from "../model/scene"

/** A free element with nothing to size it by still has to be somewhere and be grabbable. */
const FREE_WIDTH = 160
const FREE_HEIGHT = 90
const FRAME_WIDTH = 320
const FRAME_HEIGHT = 220

export interface ProjectOptions {
  /** The templates the server serves, and which of them a document that names none resolves against. */
  readonly templates: readonly StyleTemplate[]
  readonly defaultTemplateId: string
  /** Left out in the browser, where the canvas measurer is right; supplied by tests and by arrange. */
  readonly measure?: TextMeasurer
}

export function projectScene(document: MindmapDocument, options: ProjectOptions): Scene {
  const measure = options.measure ?? canvasMeasurer()
  const hierarchy = analyzeHierarchy(document)

  const byId = new Map<string, StyleTemplate>()
  for (const template of options.templates) {
    byId.set(template.id, template)
  }
  const documentTemplate =
    byId.get(document.canvas?.defaultTemplateId ?? "") ??
    byId.get(options.defaultTemplateId) ??
    EMPTY_TEMPLATE

  const clusterTemplates = new Map<string, string | null>()
  for (const cluster of document.clusters ?? []) {
    clusterTemplates.set(cluster.rootId, cluster.templateId ?? null)
  }
  const chains = new Map<string, readonly StyleTemplate[]>()
  const chainFor = (rootId: string): readonly StyleTemplate[] => {
    const cached = chains.get(rootId)
    if (cached) {
      return cached
    }
    const chain = templateChain(clusterTemplates.get(rootId), documentTemplate, byId)
    chains.set(rootId, chain)
    return chain
  }

  const elements: SceneElement[] = []
  const drawn = new Map<string, SceneElement>()

  for (const element of document.elements ?? []) {
    const node = hierarchy.byId.get(element.id)
    // Under a collapse: the layout puts it nowhere and the scene leaves it out entirely, rather than
    // drawing it somewhere stale and hiding it. An element the culler never sees costs nothing.
    if (node?.hidden) {
      continue
    }

    const projected = projectElement(element, node ? contextOf(node) : FREE_CONTEXT, node, hierarchy, chainFor, measure)
    elements.push(projected)
    drawn.set(projected.id, projected)
  }

  const edges: SceneEdge[] = []
  for (const edge of document.edges ?? []) {
    const from = drawn.get(edge.fromId)
    const to = drawn.get(edge.toId)
    // An edge to something not drawn is not an error, it is the other half of a collapse.
    if (!from || !to) {
      continue
    }

    const kind = edgeKind(edge)
    const chain = chainFor(hierarchy.byId.get(edge.fromId)?.rootId ?? edge.fromId)
    const style = resolveEdgeStyle(edge.style, kind, document.canvas?.edgeDefaults, chain)

    const taper = kind === "hierarchy" && style.widthProfile === "taper"
    const widths = taper ? ribbonWidths(from.depth, to.depth, style.thickness) : null

    edges.push({
      id: edge.id,
      fromId: edge.fromId,
      toId: edge.toId,
      kind,
      label: edge.label ?? undefined,
      routing: style.routing,
      lineStyle: style.line,
      startCap: style.startCap,
      endCap: style.endCap,
      // A branch takes the colour of the child it feeds, so a branch reads as one thing from its
      // first segment rather than changing hue at the node that owns the colour.
      color: cssColor(style.color) ?? (kind === "hierarchy" ? to.branchColor : undefined),
      thickness: style.thickness ?? undefined,
      fromWidth: widths?.fromWidth,
      toWidth: widths?.toWidth,
    })
  }

  return {
    id: document.id,
    elements,
    edges,
    background: document.canvas?.background ?? "dots",
  }
}

/** A document naming a template nobody has: no rules, so every node falls through to the theme. */
const EMPTY_TEMPLATE: StyleTemplate = { id: "", name: "" }

function contextOf(node: { depth: number; branch: number }): StyleContext {
  return { depth: node.depth, branchIndex: node.branch, isRoot: node.depth === 0 }
}

function projectElement(
  element: MindmapElement,
  context: StyleContext,
  node: { id: string; depth: number; branch: number; rootId: string } | undefined,
  hierarchy: Hierarchy,
  chainFor: (rootId: string) => readonly StyleTemplate[],
  measure: TextMeasurer,
): SceneElement {
  const kind = elementKind(element)
  // Templates describe trees. A shape, a caption or a frame is not in one, and gets its own style over
  // the theme and nothing in between.
  const chain = node ? chainFor(node.rootId) : []
  const style = resolveStyle(element.style, context, chain)

  const isRoot = context.isRoot
  const text = contentText(element.content) ?? ""
  const measured = measureNode(
    {
      text,
      shape: style.nodeShape,
      fontScale: style.fontScale,
      isRoot,
      isTask: element.content.$type === "task",
      isCollapsed: element.collapsed === true,
    },
    measure,
  )

  const childCount = node ? childrenIds(hierarchy, node.id).length : 0

  return {
    id: element.id,
    kind,
    content: element.content,
    x: element.x ?? 0,
    y: element.y ?? 0,
    width: element.width ?? defaultWidth(kind, measured.width),
    height: element.height ?? defaultHeight(kind, measured.height),
    pinned: element.pinned,
    collapsed: element.collapsed,
    fill: cssColor(style.fill),
    stroke: cssColor(style.stroke),
    textColor: cssColor(style.textColor),
    depth: context.depth,
    branch: context.branchIndex,
    nodeShape: style.nodeShape,
    text: {
      lines: measured.lines,
      fontSize: measured.font.size,
      fontWeight: measured.font.weight,
      lineHeight: measured.lineHeight,
      letterSpacing: measured.font.letterSpacing,
    },
    padding: measured.padding,
    isRoot,
    childCount,
    hiddenCount: element.collapsed && node ? hiddenDescendantCount(hierarchy, node.id) : 0,
    branchColor: cssColor(style.branchColor),
    // Only a plain node has a rule for a branch to meet. Every other shape has a box.
    underline: kind === "node" && style.nodeShape === "plain" ? branchWidth(context.depth) : undefined,
    icon: style.icon ?? undefined,
  }
}

/** A frame and an image are sized by what they hold, not by a label, so neither can be measured. */
function defaultWidth(kind: ElementKind, measured: number): number {
  if (kind === "frame") return FRAME_WIDTH
  if (kind === "image") return FREE_WIDTH
  return measured
}

function defaultHeight(kind: ElementKind, measured: number): number {
  if (kind === "frame") return FRAME_HEIGHT
  if (kind === "image") return FREE_HEIGHT
  return measured
}
