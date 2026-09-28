/**
 * Two rings of eight: one over an element (the same for one target or many), one over empty canvas.
 * A sector that does not apply is dimmed, never removed, so a direction always means one thing.
 */

import { BRANCH_COUNT } from "../scene/tokens"
import type { LayoutAlgorithm, NodeShape, ShapeType } from "../model/document"
import { ALIGNS, DISTRIBUTES, LAYOUT_KEY, SHAPES } from "./choices"
import type { RingHit } from "./radial"
import { GROUPS } from "./toolbar/groups"

export type RingGlyph =
  | { readonly kind: "icon"; readonly name: string }
  | { readonly kind: "shape"; readonly shape: ShapeType }
  | { readonly kind: "node"; readonly shape: NodeShape }
  | { readonly kind: "layout"; readonly algorithm: LayoutAlgorithm }
  | { readonly kind: "swatch"; readonly index: number }

export interface RingItem {
  /** What the caller is handed back when this is picked. */
  readonly id: string
  /** The name the hub shows, in the Mindmap namespace. A swatch is named by its number instead. */
  readonly nameKey: string
  readonly glyph: RingGlyph
  /** The catalog action that does the same thing, whose chord the hub shows. */
  readonly action?: string
}

/**
 * A sector with a sub-ring does not act on its own: releasing on it repeats the last item picked
 * from that sub-ring, and does nothing until one has been.
 */
export interface RingSector extends RingItem {
  /** The short label drawn on the wedge. */
  readonly labelKey: string
  readonly sub?: readonly RingItem[]
}

export type RingContext = "canvas" | "element"

const icon = (name: string): RingGlyph => ({ kind: "icon", name })

export const ON_CANVAS: readonly RingSector[] = [
  { id: "node", labelKey: "RadialNode", nameKey: "AddNode", glyph: icon("square-plus"), action: "mindmap.new-node" },
  {
    id: "shape",
    labelKey: "ToolShape",
    nameKey: "ToolShape",
    glyph: icon("shapes"),
    // The toolbar's own list, so the flyout and the ring cannot offer different shapes.
    sub: GROUPS.shape.options.map((option) => ({
      id: `shape:${option.id}`,
      nameKey: option.label,
      glyph: { kind: "shape", shape: option.id as ShapeType },
    })),
  },
  { id: "text", labelKey: "NewText", nameKey: "AddText", glyph: icon("type"), action: "mindmap.new-text" },
  {
    id: "insert",
    labelKey: "RadialInsert",
    nameKey: "RadialInsert",
    glyph: icon("layers"),
    sub: [
      { id: "note-link", nameKey: "RadialLinkToNote", glyph: icon("link") },
      { id: "deck-link", nameKey: "RadialLinkToDeck", glyph: icon("square-stack") },
      { id: "equation", nameKey: "RadialEquation", glyph: icon("sigma") },
    ],
  },
  { id: "image", labelKey: "RadialImage", nameKey: "ToolImage", glyph: icon("image"), action: "mindmap.new-image" },
  { id: "frame", labelKey: "NewFrame", nameKey: "ToolFrame", glyph: icon("frame"), action: "mindmap.new-frame" },
  {
    id: "layout",
    labelKey: "Layout",
    nameKey: "Layout",
    glyph: icon("network"),
    sub: [
      ...(["balanced", "treeRight", "treeDown", "radial"] as const).map(
        (algorithm): RingItem => ({ id: `layout:${algorithm}`, nameKey: LAYOUT_KEY[algorithm], glyph: { kind: "layout", algorithm } }),
      ),
      { id: "arrange", nameKey: "RadialTidyUp", glyph: icon("wand-sparkles") },
    ],
  },
  {
    id: "view",
    labelKey: "View",
    nameKey: "View",
    glyph: icon("eye"),
    sub: [
      { id: "fit", nameKey: "FitToScreen", glyph: icon("maximize"), action: "mindmap.recenter" },
      { id: "actual-size", nameKey: "RadialActualSize", glyph: icon("scan") },
      { id: "minimap", nameKey: "Minimap", glyph: icon("map") },
    ],
  },
]

/** How the element ring names the two sectors that toggle. */
export interface ElementRingState {
  /** Every target with children is already collapsed, so the sector expands. */
  readonly collapsed: boolean
  /** Every target node is already pinned, so the sector unpins. */
  readonly pinned: boolean
}

function elementSectors({ collapsed, pinned }: ElementRingState): readonly RingSector[] {
  return [
    {
      id: "color",
      labelKey: "Color",
      nameKey: "BranchColor",
      glyph: icon("palette"),
      sub: Array.from({ length: BRANCH_COUNT }, (_, index) => ({
        id: `color:${index}`,
        nameKey: "Color",
        glyph: { kind: "swatch", index } as const,
      })),
    },
    {
      id: "node-shape",
      labelKey: "Shape",
      nameKey: "RadialNodeShape",
      glyph: icon("rectangle-horizontal"),
      sub: SHAPES.map((entry) => ({ id: `node-shape:${entry.value}`, nameKey: entry.key, glyph: { kind: "node", shape: entry.value } })),
    },
    { id: "connect", labelKey: "Connect", nameKey: "Connect", glyph: icon("spline"), action: "mindmap.connect" },
    {
      id: "link",
      labelKey: "RadialLink",
      nameKey: "RadialLink",
      glyph: icon("link"),
      sub: [
        { id: "link:note", nameKey: "RadialLinkANote", glyph: icon("link") },
        { id: "link:flashcard", nameKey: "RadialLinkADeck", glyph: icon("square-stack") },
      ],
    },
    {
      id: "collapse",
      labelKey: collapsed ? "RadialExpand" : "RadialCollapse",
      nameKey: collapsed ? "ExpandBranch" : "CollapseBranch",
      glyph: icon(collapsed ? "chevrons-up-down" : "chevrons-down-up"),
    },
    { id: "group", labelKey: "NewFrame", nameKey: "RadialGroupInFrame", glyph: icon("frame") },
    {
      id: "align",
      labelKey: "Align",
      nameKey: "Align",
      glyph: icon("common/align-start-vertical"),
      sub: [...ALIGNS, ...DISTRIBUTES].map((entry) => ({ id: `align:${entry.op}`, nameKey: entry.key, glyph: icon(entry.icon) })),
    },
    { id: "pin", labelKey: pinned ? "Unpin" : "Pin", nameKey: pinned ? "Unpin" : "Pin", glyph: icon("pin") },
  ]
}

const ELEMENT_RINGS = new Map<string, readonly RingSector[]>()

/** The element ring, named for the state of its targets. Cached so a ring keeps its identity between renders. */
export function onElements(state: ElementRingState): readonly RingSector[] {
  const key = `${state.collapsed}:${state.pinned}`
  let ring = ELEMENT_RINGS.get(key)
  if (!ring) {
    ring = elementSectors(state)
    ELEMENT_RINGS.set(key, ring)
  }
  return ring
}

/**
 * What a release over `hit` picks: a sub item, a sector with no sub-ring, or the item last picked
 * from a sector's sub-ring. Nothing for a dimmed sector or item, or a sub-ring never picked from.
 */
export function pickOf(
  sectors: readonly RingSector[],
  hit: RingHit,
  inert: ReadonlySet<string>,
  remembered: (sectorId: string) => string | null,
): string | null {
  const sector = hit.hot === null ? undefined : sectors[hit.hot]
  if (!sector || inert.has(sector.id)) {
    return null
  }
  const picked = hit.sub !== null ? (sector.sub?.[hit.sub]?.id ?? null) : sector.sub ? remembered(sector.id) : sector.id
  return picked !== null && inert.has(picked) ? null : picked
}

/** A pick as its sector id and the value a sub item carries after the colon: "shape:ellipse". */
export function splitPick(picked: string): [id: string, value: string] {
  const colon = picked.indexOf(":")
  return colon < 0 ? [picked, ""] : [picked.slice(0, colon), picked.slice(colon + 1)]
}
