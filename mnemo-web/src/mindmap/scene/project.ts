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
 *
 * Pure, and structurally shared. An edit produces a whole new document, but one whose untouched
 * elements are the very objects the previous one held, so this returns the very scene elements the
 * previous scene held for them. That is not an optimisation of this module: it is what lets the
 * renderer's `memo` do its job at all, since a fresh object per element per edit is a prop change
 * for every node on the canvas whether or not anything about it moved.
 */

import { branchWidth } from "./branch-width"
import { FREE_CONTEXT, resolveStyle, templateChain, type ResolvedStyle, type StyleContext } from "./cascade"
import { bodyOf, displayText, isRef, refKey, type RefInfo } from "./content"
import { resolveEdgeStyle, ribbonWidths } from "./edge-cascade"
import { analyzeHierarchy, childrenIds, hiddenDescendantCount, type Hierarchy } from "./hierarchy"
import { measureNode, type Measurers } from "./measure"
import { cssColor, washOf } from "./tokens"
import {
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
  /**
   * How text and equations are sized. Required rather than defaulted, because the right answer is
   * not the same everywhere: the canvas wants real rendering, and a wall of thumbnails wants
   * arithmetic. A default here would quietly give one of them the other one's cost.
   */
  readonly measurers: Measurers
  /**
   * What the map's note and deck references turned out to be, keyed as `refKey` says.
   *
   * Applied here rather than in the renderer because a resolved title is what the box was sized
   * around: a node whose label arrives after layout is a node the layout packed at the wrong width.
   * A key that is absent has not come back yet, which is a node drawn with its mark and no title.
   */
  readonly refs?: ReadonlyMap<string, RefInfo>
}

export function projectScene(document: MindmapDocument, options: ProjectOptions): Scene {
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
  const frames: { element: MindmapElement; base: SceneElement }[] = []
  const drawn = new Map<string, SceneElement>()

  for (const element of document.elements ?? []) {
    const node = hierarchy.byId.get(element.id)
    // Under a collapse: the layout puts it nowhere and the scene leaves it out entirely, rather than
    // drawing it somewhere stale and hiding it. An element the culler never sees costs nothing.
    if (node?.hidden) {
      continue
    }

    const projected = projectElement(element, node ? contextOf(node) : FREE_CONTEXT, node, hierarchy, chainFor, options)
    // Frames wait for a second pass: one is wherever its members are, and none of them have been
    // measured yet at this point in the walk.
    if (projected.kind === "frame") {
      frames.push({ element, base: projected })
      continue
    }
    elements.push(projected)
    drawn.set(projected.id, projected)
  }

  const sized = frames.map(({ element, base }) => sizeFrame(element, base, drawn))
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
function sizeFrame(
  element: MindmapElement,
  base: SceneElement,
  drawn: ReadonlyMap<string, SceneElement>,
): SceneElement {
  const members: SceneElement[] = []
  for (const id of (base.content as FrameContent).childIds ?? []) {
    const member = drawn.get(id)
    if (member) {
      members.push(member)
    }
  }

  const box = frameBox(members)
  // The count is the live membership rather than the stored list, so a member that was deleted is off
  // the badge as well as out of the box.
  const count = members.length
  /** The box this call is going to end up with, whether it derived one or kept the stored one. */
  const target = box ?? base

  // Sized frames get their own memo rather than riding the one below, because a frame's box is the
  // one thing in the scene that is not a function of its own element: it moves when its members do.
  // A base that is the same object settles every other field, so only the box and the count are left
  // to compare.
  const cached = sizedFrames.get(element)
  if (
    cached &&
    cached.base === base &&
    cached.result.childCount === count &&
    cached.result.x === target.x &&
    cached.result.y === target.y &&
    cached.result.width === target.width &&
    cached.result.height === target.height
  ) {
    return cached.result
  }

  const result = box ? { ...base, ...box, childCount: count } : { ...base, childCount: count }
  sizedFrames.set(element, { base, result })
  return result
}

/** A document naming a template nobody has: no rules, so every node falls through to the theme. */
const EMPTY_TEMPLATE: StyleTemplate = { id: "", name: "" }

function contextOf(node: { depth: number; branch: number }): StyleContext {
  return { depth: node.depth, branchIndex: node.branch, isRoot: node.depth === 0 }
}

const NO_CHAIN: readonly StyleTemplate[] = []

/**
 * Everything a projected element depends on that is not the element itself.
 *
 * Named exhaustively and compared per call, because the element's own identity is the tempting key
 * and the wrong one: a node whose object nobody touched still has to be reprojected when the
 * template under it changed, when its title finished resolving, when a collapse somewhere above
 * moved it down a level, or when a child was added to it. Each of those is a field here, and adding
 * a projected field that reads anything else means adding it here too.
 *
 * The reference is held by value rather than by object identity on purpose: the resolution map is
 * rebuilt on every document change, so an entry that says the same thing as before is a new object
 * every time and comparing it by reference would refresh every reference node on every edit.
 */
interface ProjectInputs {
  readonly depth: number
  readonly branchIndex: number
  readonly isRoot: boolean
  /** The cluster's templates, most specific first. Compared member by member; it is one or two long. */
  readonly chain: readonly StyleTemplate[]
  /** How text is sized. A different set is a different box for the same words. */
  readonly measurers: Measurers
  readonly refLabel: string | undefined
  readonly refBadge: string | undefined
  readonly refMissing: boolean | undefined
  readonly childCount: number
  readonly hiddenCount: number
}

interface Projected {
  readonly inputs: ProjectInputs
  readonly result: SceneElement
}

/**
 * The last projection of each element, so an untouched one comes back as the same object.
 *
 * Weak, and keyed on the stored element rather than on its id, which is what makes it right in both
 * directions at once. An edit rebuilds the elements it touched and leaves the rest as they were, so
 * reference identity is already exactly "nobody changed this". A reload or an import parses a whole
 * new document, so every key misses and every element comes back fresh, with no way for one map's
 * projection to be handed to another. Nothing has to be invalidated, and nothing outlives the
 * document it belongs to.
 */
const projected = new WeakMap<MindmapElement, Projected>()

/** The same, for the second pass: a frame's box comes from its members and not from itself. */
const sizedFrames = new WeakMap<MindmapElement, { base: SceneElement; result: SceneElement }>()

function sameInputs(a: ProjectInputs, b: ProjectInputs): boolean {
  if (
    a.depth !== b.depth ||
    a.branchIndex !== b.branchIndex ||
    a.isRoot !== b.isRoot ||
    a.measurers !== b.measurers ||
    a.refLabel !== b.refLabel ||
    a.refBadge !== b.refBadge ||
    a.refMissing !== b.refMissing ||
    a.childCount !== b.childCount ||
    a.hiddenCount !== b.hiddenCount ||
    a.chain.length !== b.chain.length
  ) {
    return false
  }
  for (let i = 0; i < a.chain.length; i++) {
    if (a.chain[i] !== b.chain[i]) {
      return false
    }
  }
  return true
}

function projectElement(
  element: MindmapElement,
  context: StyleContext,
  node: { id: string; depth: number; branch: number; rootId: string } | undefined,
  hierarchy: Hierarchy,
  chainFor: (rootId: string) => readonly StyleTemplate[],
  options: ProjectOptions,
): SceneElement {
  // Templates describe trees. A shape, a caption or a frame is not in one, and gets its own style over
  // the theme and nothing in between.
  const chain = node ? chainFor(node.rootId) : NO_CHAIN
  const key = refKey(element.content)
  const ref = key ? options.refs?.get(key) : undefined

  const inputs: ProjectInputs = {
    depth: context.depth,
    branchIndex: context.branchIndex,
    isRoot: context.isRoot,
    chain,
    measurers: options.measurers,
    refLabel: ref?.label,
    refBadge: ref?.badge,
    refMissing: ref?.missing,
    childCount: node ? childrenIds(hierarchy, node.id).length : 0,
    hiddenCount: element.collapsed && node ? hiddenDescendantCount(hierarchy, node.id) : 0,
  }

  // Everything gathered above was going to be read anyway; what the hit skips is the cascade, the
  // measurement and the four objects they come wrapped in, which is all of the cost.
  const cached = projected.get(element)
  if (cached && sameInputs(cached.inputs, inputs)) {
    return cached.result
  }

  const result = buildElement(element, context, ref, inputs, options)
  projected.set(element, { inputs, result })
  return result
}

function buildElement(
  element: MindmapElement,
  context: StyleContext,
  ref: RefInfo | undefined,
  inputs: ProjectInputs,
  options: ProjectOptions,
): SceneElement {
  const kind = elementKind(element)
  const style = resolveStyle(element.style, context, inputs.chain)

  const isRoot = context.isRoot
  // A reference reads as whatever it points at, so its label replaces the content's own text rather
  // than sitting beside it. Nothing while the lookup is out, which is a node with only its mark.
  const text = ref?.label ?? displayText(element.content)
  const measured = measureNode(
    {
      text,
      shape: style.nodeShape,
      fontScale: style.fontScale,
      isRoot,
      isTask: element.content.$type === "task",
      isCollapsed: element.collapsed === true,
      isRef: isRef(element.content),
      badge: ref?.badge,
      body: bodyOf(element.content),
    },
    options.measurers,
  )

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
    textColor: cssColor(inkOf(kind, style)),
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
    childCount: inputs.childCount,
    hiddenCount: inputs.hiddenCount,
    branchColor: cssColor(style.branchColor),
    // Only a plain node has a rule for a branch to meet. Every other shape has a box.
    underline: kind === "node" && style.nodeShape === "plain" ? branchWidth(context.depth) : undefined,
    icon: style.icon ?? undefined,
    refBadge: ref?.badge,
    refMissing: ref?.missing,
  }
}

/**
 * The ink, which cannot be settled without knowing what will be painted under it.
 *
 * A template's root style names `accent` and `onAccent` together with the card rung that paints the
 * first, so the second has something to read against. The cascade resolves those three one property
 * at a time, so a root moved onto another rung keeps the pale ink and loses the fill it was for.
 *
 * Only the card paints the fill as given. A pill washes over it once the node carries a palette hue,
 * and the outline and the rule paint nothing, so the ordinary ink is the readable answer on those.
 */
function inkOf(kind: ElementKind, style: ResolvedStyle): string {
  if (style.textColor !== "onAccent" || style.fill !== "accent") {
    return style.textColor
  }
  // A caption, a shape and a picture carry no card of their own whatever rung they resolved to.
  const carded = kind === "node" && (style.nodeShape === "card" || style.nodeShape === "pill")
  // Asked the way the renderers ask it, so the ink cannot drift from the colour put under it.
  const washed = style.nodeShape === "pill" && washOf(cssColor(style.stroke)) !== null
  return carded && !washed ? style.textColor : "textPrimary"
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
