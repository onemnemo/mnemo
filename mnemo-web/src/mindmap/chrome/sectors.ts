/**
 * What the ring offers, and when.
 *
 * Three fixed sets, chosen by the selection: nothing, one element, or several. A set never changes
 * size with what is selected, because a ring is a gesture and its value is that a direction always
 * means the same thing. A sector that does not apply is dimmed in place rather than taken out.
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

export interface RingSector extends RingItem {
  /** The short label drawn on the wedge. */
  readonly labelKey: string
  readonly danger?: boolean
  readonly sub?: readonly RingItem[]
  /** False for a sector that is only a way into its sub-ring: releasing on it picks nothing. */
  readonly acts?: boolean
}

export type RingContext = "canvas" | "node" | "multi"

const icon = (name: string): RingGlyph => ({ kind: "icon", name })

export const ON_CANVAS: readonly RingSector[] = [
  { id: "node", labelKey: "RadialNode", nameKey: "AddNode", glyph: icon("square-plus"), action: "mindmap.new-node" },
  {
    id: "shape",
    labelKey: "ToolShape",
    nameKey: "ToolShape",
    glyph: icon("shapes"),
    action: "mindmap.shape-picker",
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
    acts: false,
    sub: [
      { id: "image", nameKey: "RadialImage", glyph: icon("image"), action: "mindmap.new-image" },
      { id: "frame", nameKey: "NewFrame", glyph: icon("frame"), action: "mindmap.new-frame" },
      { id: "note-link", nameKey: "RadialLinkToNote", glyph: icon("link") },
      { id: "equation", nameKey: "RadialEquation", glyph: icon("sigma") },
    ],
  },
  {
    id: "arrange",
    labelKey: "Layout",
    nameKey: "Layout",
    glyph: icon("network"),
    sub: [
      ...(["balanced", "treeRight", "treeDown", "radial"] as const).map(
        (algorithm): RingItem => ({
          id: `layout:${algorithm}`,
          nameKey: LAYOUT_KEY[algorithm],
          glyph: { kind: "layout", algorithm },
        }),
      ),
      { id: "arrange", nameKey: "RadialTidyUp", glyph: icon("wand-sparkles") },
    ],
  },
  {
    id: "fit",
    labelKey: "View",
    nameKey: "View",
    glyph: icon("eye"),
    action: "mindmap.recenter",
    sub: [
      { id: "fit", nameKey: "FitToScreen", glyph: icon("maximize"), action: "mindmap.recenter" },
      { id: "actual-size", nameKey: "RadialActualSize", glyph: icon("scan") },
      { id: "minimap", nameKey: "Minimap", glyph: icon("map") },
    ],
  },
]

function nodeSectors(collapsed: boolean): readonly RingSector[] {
  return [
    { id: "child", labelKey: "AddChild", nameKey: "RadialAddChild", glyph: icon("circle-plus"), action: "mindmap.add-child" },
    { id: "sibling", labelKey: "AddSibling", nameKey: "RadialAddSibling", glyph: icon("corner-down-left"), action: "mindmap.enter" },
    {
      id: "color",
      labelKey: "Color",
      nameKey: "BranchColor",
      glyph: icon("palette"),
      acts: false,
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
      acts: false,
      sub: SHAPES.map((entry) => ({ id: `node-shape:${entry.value}`, nameKey: entry.key, glyph: { kind: "node", shape: entry.value } })),
    },
    { id: "connect", labelKey: "Connect", nameKey: "Connect", glyph: icon("spline"), action: "mindmap.connect" },
    { id: "note", labelKey: "KindNote", nameKey: "RadialLinkANote", glyph: icon("link") },
    {
      id: "collapse",
      labelKey: "RadialCollapse",
      nameKey: collapsed ? "ExpandBranch" : "CollapseBranch",
      glyph: icon(collapsed ? "chevrons-up-down" : "chevrons-down-up"),
    },
    { id: "delete", labelKey: "Delete", nameKey: "Delete", glyph: icon("trash-2"), danger: true, action: "mindmap.delete-selection" },
    { id: "edit", labelKey: "Edit", nameKey: "RadialEditText", glyph: icon("pencil"), action: "mindmap.edit-edge-label" },
  ]
}

const ON_NODE_OPEN = nodeSectors(false)
const ON_NODE_COLLAPSED = nodeSectors(true)

/** With one element selected. Collapse names what a release would do, which depends on the node. */
export function onNode(collapsed: boolean): readonly RingSector[] {
  return collapsed ? ON_NODE_COLLAPSED : ON_NODE_OPEN
}

export const ON_SEVERAL: readonly RingSector[] = [
  {
    id: "align",
    labelKey: "Align",
    nameKey: "Align",
    glyph: icon("common/align-start-vertical"),
    acts: false,
    sub: ALIGNS.map((entry) => ({ id: `align:${entry.op}`, nameKey: entry.key, glyph: icon(entry.icon) })),
  },
  {
    id: "distribute",
    labelKey: "Distribute",
    nameKey: "Distribute",
    glyph: icon("common/align-horizontal-distribute-center"),
    acts: false,
    sub: DISTRIBUTES.map((entry) => ({ id: `align:${entry.op}`, nameKey: entry.key, glyph: icon(entry.icon) })),
  },
  { id: "group", labelKey: "NewFrame", nameKey: "RadialGroupInFrame", glyph: icon("frame") },
  { id: "match", labelKey: "RadialMatch", nameKey: "RadialMatchStyle", glyph: icon("paintbrush") },
  { id: "duplicate", labelKey: "Duplicate", nameKey: "Duplicate", glyph: icon("copy"), action: "mindmap.duplicate" },
  { id: "delete", labelKey: "Delete", nameKey: "RadialDeleteAll", glyph: icon("trash-2"), danger: true, action: "mindmap.delete-selection" },
]

/** Which set a selection of `count` elements opens. */
export function ringContext(count: number): RingContext {
  return count === 0 ? "canvas" : count === 1 ? "node" : "multi"
}

/** What a release over `hit` picks: a sub item, a sector that acts on its own, or nothing. */
export function pickOf(sectors: readonly RingSector[], hit: RingHit): string | null {
  if (hit.hot === null) {
    return null
  }
  const sector = sectors[hit.hot]
  if (!sector) {
    return null
  }
  if (hit.sub !== null) {
    return sector.sub?.[hit.sub]?.id ?? null
  }
  return sector.sub && sector.acts === false ? null : sector.id
}

/** A pick as its sector id and the value a sub item carries after the colon: "shape:ellipse". */
export function splitPick(picked: string): [id: string, value: string] {
  const colon = picked.indexOf(":")
  return colon < 0 ? [picked, ""] : [picked.slice(0, colon), picked.slice(colon + 1)]
}
