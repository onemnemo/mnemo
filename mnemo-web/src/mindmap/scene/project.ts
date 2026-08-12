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
  type FrameContent,
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

/** How far a frame stands off the things it holds, and the strip its title sits in above them. */
export const FRAME_PAD = 18
export const FRAME_HEAD = 22

/** Enough of an element to put a frame around. Boxes come from the scene, or from a live drag. */
export interface FrameMemberBox {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/**
 * A frame's box, from the things it holds, or null when it holds nothing.
 *
 * Exported because the frame tool works this out before the frame exists: what it stores has to be
 * what the projector will derive, or a new group would jump the first time anything moved it.
 */
export function frameBox(members: readonly FrameMemberBox[]): FrameMemberBox | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const member of members) {
    if (member.x < minX) minX = member.x
    if (member.y < minY) minY = member.y
    if (member.x + member.width > maxX) maxX = member.x + member.width
    if (member.y + member.height > maxY) maxY = member.y + member.height
  }
  if (!Number.isFinite(minX)) {
    return null
  }
  return {
    x: minX - FRAME_PAD,
    y: minY - FRAME_PAD - FRAME_HEAD,
    width: maxX - minX + FRAME_PAD * 2,
    height: maxY - minY + FRAME_PAD * 2 + FRAME_HEAD,
  }
}

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
  const frames: SceneElement[] = []
  const drawn = new Map<string, SceneElement>()

  for (const element of document.elements ?? []) {
    const node = hierarchy.byId.get(element.id)
    // Under a collapse: the layout puts it nowhere and the scene leaves it out entirely, rather than
    // drawing it somewhere stale and hiding it. An element the culler never sees costs nothing.
    if (node?.hidden) {
      continue
    }

    const projected = projectElement(element, node ? contextOf(node) : FREE_CONTEXT, node, hierarchy, chainFor, measure)
    // Frames wait for a second pass: one is wherever its members are, and none of them have been
    // measured yet at this point in the walk.
    if (projected.kind === "frame") {
      frames.push(projected)
      continue
    }
    elements.push(projected)
    drawn.set(projected.id, projected)
  }

  const sized = frames.map((frame) => sizeFrame(frame, drawn))
  for (const frame of sized) {
    drawn.set(frame.id, frame)
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
    // Frames first, because the scene is in paint order and a frame is a backdrop for what it holds
    // rather than a box drawn over it.
    elements: [...sized, ...elements],
    edges,
    background: document.canvas?.background ?? "dots",
  }
}

/**
 * A frame, sized by its members.
 *
 * Membership is an explicit id list rather than a region, which is what makes the box derived rather
 * than stored: a region frame stops holding what it held the moment anything moves, and Arrange moves
 * everything. A frame whose members are all gone or all under a collapse keeps its stored box, since
 * a group with no area is one nobody could see to drop anything into.
 */
function sizeFrame(frame: SceneElement, drawn: ReadonlyMap<string, SceneElement>): SceneElement {
  const members: SceneElement[] = []
  for (const id of (frame.content as FrameContent).childIds ?? []) {
    const member = drawn.get(id)
    if (member) {
      members.push(member)
    }
  }

  const box = frameBox(members)
  // The count is the live membership rather than the stored list, so a member that was deleted is off
  // the badge as well as out of the box.
  return box ? { ...frame, ...box, childCount: members.length } : { ...frame, childCount: members.length }
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
