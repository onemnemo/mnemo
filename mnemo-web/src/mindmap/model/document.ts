/**
 * The map document, as it is stored and as it crosses the wire.
 *
 * These are hand mirrors of `Mnemo.Core/Models/Mindmap/*.cs`, not of a host DTO: mindmap payloads
 * are serialized with the storage serializer, so the JSON here is the JSON on disk. That serializer
 * omits default-valued properties, which is why almost everything below is optional even where the
 * C# record has a non-nullable field with a default. Read a missing value as its default, never as
 * an error.
 */

/** What an element *is*. Only `node` participates in the hierarchy. */
export type ElementKind = "node" | "shape" | "text" | "image" | "frame"

export type EdgeKind = "hierarchy" | "link"

/* -------------------------------------------------------------------------- */
/* Content                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Element content is a discriminated union over `$type`, carrying the same discriminator strings
 * storage uses. An unknown `$type` round-trips through the server as a placeholder rather than
 * failing the load, so the client has to expect a kind it does not know about and render it as
 * plain text rather than crash.
 */
export type ElementContent =
  | TextContent
  | TaskContent
  | CodeContent
  | MathContent
  | LinkContent
  | NoteContent
  | FlashcardContent
  | ImageContent
  | ShapeContent
  | FreeTextContent
  | CanvasImageContent
  | FrameContent
  | UnknownContent

export interface TextContent {
  $type: "text"
  text?: string
}

export interface TaskContent {
  $type: "task"
  text?: string
  done?: boolean
  due?: string | null
}

export interface CodeContent {
  $type: "code"
  language?: string
  source?: string
}

export interface MathContent {
  $type: "math"
  latex?: string
}

export interface LinkContent {
  $type: "link"
  url: string
  title?: string | null
}

export interface NoteContent {
  $type: "note"
  noteId: string
  blockId?: string | null
}

export interface FlashcardContent {
  $type: "flashcard"
  deckId: string
  cardId?: string | null
}

export interface ImageContent {
  $type: "image"
  assetId: string
  caption?: string | null
}

export type ShapeType = "rectangle" | "ellipse" | "diamond" | "hexagon" | "parallelogram" | "line" | "arrow"

export interface ShapeContent {
  $type: "shape"
  shape?: ShapeType
  text?: string | null
}

export interface FreeTextContent {
  $type: "freeText"
  text?: string
}

export interface CanvasImageContent {
  $type: "canvasImage"
  assetId: string
}

/** Membership is an explicit id list, so a frame is wherever its members are. */
export interface FrameContent {
  $type: "frame"
  title?: string
  childIds?: string[]
}

/** A `$type` this build does not know. Preserved, never edited. */
export interface UnknownContent {
  $type: string
  [key: string]: unknown
}

/* -------------------------------------------------------------------------- */
/* Style                                                                      */
/* -------------------------------------------------------------------------- */

export type FontScale = "s" | "m" | "l" | "xl"

/** How a node is drawn. A ladder of loudness: no chrome, a tint, a card, an outline. */
export type NodeShape = "card" | "pill" | "plain" | "outline"

/**
 * A per-element override. Every member is optional because the cascade resolves each property
 * independently: element override, then the template chain, then the theme default.
 *
 * Colours are either a theme token name (`accent`, `palette.3`) or a raw `#RRGGBB` literal.
 */
export interface ElementStyle {
  fill?: string | null
  stroke?: string | null
  textColor?: string | null
  fontScale?: FontScale | null
  nodeShape?: NodeShape | null
  icon?: string | null
}

/** How a line is drawn along its length. */
export type LineStyle = "solid" | "dashed" | "dotted" | "double"

/** How it gets from one end to the other. */
export type EdgeRouting = "curve" | "straight" | "orthogonal"

/** What sits on an end. Start and end are independent, which is what gives arrow-left vs arrow-right. */
export type ArrowCap = "none" | "arrow" | "dot"

export interface EdgeStyle {
  line?: LineStyle | null
  routing?: EdgeRouting | null
  startCap?: ArrowCap | null
  endCap?: ArrowCap | null
  color?: string | null
  thickness?: number | null
}

/* -------------------------------------------------------------------------- */
/* The document                                                               */
/* -------------------------------------------------------------------------- */

export interface MindmapElement {
  id: string
  kind?: ElementKind
  content: ElementContent
  x?: number
  y?: number
  width?: number | null
  height?: number | null
  pinned?: boolean
  collapsed?: boolean
  style?: ElementStyle | null
  meta?: Record<string, string> | null
}

export interface MindmapEdge {
  id: string
  fromId: string
  toId: string
  kind?: EdgeKind
  label?: string | null
  style?: EdgeStyle | null
}

export interface LayoutOptions {
  nodeSpacing?: number | null
  rankSpacing?: number | null
  edgeLength?: number | null
}

/** Per-cluster (per root) layout and template choice. */
export interface ClusterSettings {
  rootId: string
  layoutAlgorithm?: string
  options?: LayoutOptions | null
  templateId?: string | null
}

export type CanvasBackground = "dots" | "grid" | "plain"

export interface MindmapCanvasOptions {
  background?: CanvasBackground
  defaultTemplateId?: string | null
}

export interface MindmapDocument {
  schemaVersion?: number
  id: string
  title?: string
  revision?: number
  elements?: MindmapElement[]
  edges?: MindmapEdge[]
  clusters?: ClusterSettings[]
  canvas?: MindmapCanvasOptions
  createdAt?: string
  modifiedAt?: string
}

export interface MindmapDocumentSummary {
  id: string
  title: string
  revision?: number
  modifiedAt?: string
}

export interface MindmapLibraryEntry {
  document: MindmapDocument
  folderId?: string | null
  linkedDeckIds?: string[]
}

export interface MindmapFolder {
  id: string
  name: string
  parentId?: string | null
  order?: number
}

/* -------------------------------------------------------------------------- */
/* Styling templates                                                          */
/* -------------------------------------------------------------------------- */

export type BranchColorMode = "none" | "byBranch"

export interface DepthRule {
  minDepth?: number
  maxDepth?: number | null
  style: ElementStyle
}

export interface StyleTemplate {
  id: string
  name: string
  rootStyle?: ElementStyle | null
  depthRules?: DepthRule[]
  branchColors?: BranchColorMode
  edgeDefaults?: EdgeStyle | null
  layoutDefaults?: LayoutOptions | null
}

/** The layout algorithms the server ships. */
export const LAYOUT_ALGORITHMS = ["balanced", "treeRight", "treeDown", "radial", "timeline", "free"] as const

export type LayoutAlgorithm = (typeof LAYOUT_ALGORITHMS)[number]

/* -------------------------------------------------------------------------- */
/* Convenience                                                                */
/* -------------------------------------------------------------------------- */

/** The text slot for a content kind, or null when the kind carries no text. */
export function contentText(content: ElementContent): string | null {
  switch (content.$type) {
    case "text":
    case "task":
    case "freeText":
      return (content as { text?: string }).text ?? ""
    case "code":
      return (content as CodeContent).source ?? ""
    case "math":
      return (content as MathContent).latex ?? ""
    case "link":
      return (content as LinkContent).title ?? ""
    case "shape":
      return (content as ShapeContent).text ?? ""
    case "frame":
      return (content as FrameContent).title ?? ""
    default:
      // Refs and images carry a target, not a label; their caption comes from resolving that target.
      return null
  }
}

export function elementKind(element: MindmapElement): ElementKind {
  return element.kind ?? "node"
}

export function edgeKind(edge: MindmapEdge): EdgeKind {
  return edge.kind ?? "hierarchy"
}
