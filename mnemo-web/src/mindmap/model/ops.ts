/**
 * The edit vocabulary.
 *
 * Eleven op families, in the compact wire grammar the server parses (`MindmapToolOpParser`). Every
 * gesture on the canvas and every AI tool call funnels through the same eleven, which is what keeps
 * agent edits undoable and keeps the tool surface from lagging behind the editor.
 *
 * The shapes are terse (`t` for text, `xy` for a coordinate pair, `c` for children) because that
 * grammar was designed for a model's token budget first. Nothing outside this file should hand-write
 * one: use the builders at the bottom, so a renamed field is a compile error rather than a silently
 * ignored property.
 */

import type {
  CanvasBackground,
  EdgeStyle,
  ElementContent,
  ElementKind,
  ElementStyle,
  LayoutOptions,
} from "./document"

/** A node to create, possibly with a nested subtree under it. */
export interface NodeSpec {
  /** Caller-local key; the created id comes back in the result's `createdIds` under it. */
  ref?: string
  /** Shorthand for text content. Ignored when `content` is set. */
  t?: string
  content?: ElementContent
  c?: NodeSpec[]
  /** Placing a node explicitly also pins it. */
  xy?: [number, number]
}

export type MindmapOp =
  | AddNodesOp
  | SetOp
  | MoveOp
  | DeleteOp
  | LinkOp
  | UnlinkOp
  | SetEdgeOp
  | StyleSubtreeOp
  | LayoutOp
  | AddElementOp
  | FrameOp

/** Insert a subtree. No `under` starts a new floating cluster. */
export interface AddNodesOp {
  op: "add"
  under?: string
  after?: string
  nodes: NodeSpec[]
}

/** Partial update of one element. Absent members are left alone. */
export interface SetOp {
  op: "set"
  id: string
  t?: string
  content?: ElementContent
  /** Merged onto the existing override; non-null members win. */
  style?: ElementStyle
  /** Drops the existing override first, which is the only way back to the template default. */
  clear_style?: boolean
  collapsed?: boolean
  pinned?: boolean
  wh?: [number, number]
}

/** Reparent (`under`) or reposition (`xy`). Repositioning implies pinning. */
export interface MoveOp {
  op: "move"
  id: string
  under?: string
  after?: string
  xy?: [number, number]
}

export interface DeleteOp {
  op: "del"
  ids: string[]
}

export interface LinkOp {
  op: "link"
  ref?: string
  a: string
  b: string
  label?: string
  style?: EdgeStyle
}

export interface UnlinkOp {
  op: "unlink"
  edge?: string
  a?: string
  b?: string
}

export interface SetEdgeOp {
  op: "set_edge"
  edge: string
  /** An empty string clears the label; omitting it leaves the label alone. */
  label?: string
  style?: EdgeStyle
  clear_style?: boolean
}

/** Push one element's own overrides down a subtree. Never its resolved look, only its overrides. */
export interface StyleSubtreeOp {
  op: "style_subtree"
  root?: string
  ids?: string[]
  style: ElementStyle
}

/**
 * Per-cluster layout and template. With no `root` it sets document-wide defaults instead, which is
 * how the map-style panel writes the branch material as a real, undoable edit rather than as view
 * state that evaporates the moment you navigate away.
 */
export interface LayoutOp {
  op: "layout"
  root?: string
  algo?: string
  template?: string
  options?: LayoutOptions
  /** Merged onto the canvas defaults, so choosing a material does not clear a colour beside it. */
  edge_defaults?: EdgeStyle
  /** What the map sits on. Document-wide, so it is only read when no `root` is named. */
  background?: CanvasBackground
}

/** Create a free element: shape, free text, canvas image or frame. */
export interface AddElementOp {
  op: "add_el"
  ref?: string
  kind: ElementKind
  xy: [number, number]
  content: ElementContent
  wh?: [number, number]
}

export interface FrameOp {
  op: "frame"
  id: string
  add?: string[]
  remove?: string[]
}

/* -------------------------------------------------------------------------- */
/* Builders                                                                   */
/* -------------------------------------------------------------------------- */

export const op = {
  addNodes: (nodes: NodeSpec[], under?: string, after?: string): AddNodesOp =>
    prune({ op: "add", nodes, under, after }),

  set: (id: string, patch: Omit<SetOp, "op" | "id">): SetOp => prune({ op: "set", id, ...patch }),

  moveTo: (id: string, x: number, y: number): MoveOp => ({ op: "move", id, xy: [x, y] }),

  reparent: (id: string, under: string, after?: string): MoveOp => prune({ op: "move", id, under, after }),

  del: (ids: string[]): DeleteOp => ({ op: "del", ids }),

  link: (a: string, b: string, extra?: { ref?: string; label?: string; style?: EdgeStyle }): LinkOp =>
    prune({ op: "link", a, b, ...extra }),

  unlinkEdge: (edge: string): UnlinkOp => ({ op: "unlink", edge }),

  unlinkPair: (a: string, b: string): UnlinkOp => ({ op: "unlink", a, b }),

  setEdge: (edge: string, patch: Omit<SetEdgeOp, "op" | "edge">): SetEdgeOp =>
    prune({ op: "set_edge", edge, ...patch }),

  styleSubtree: (root: string, style: ElementStyle): StyleSubtreeOp => ({ op: "style_subtree", root, style }),

  styleIds: (ids: string[], style: ElementStyle): StyleSubtreeOp => ({ op: "style_subtree", ids, style }),

  layout: (patch: Omit<LayoutOp, "op">): LayoutOp => prune({ op: "layout", ...patch }),

  addElement: (
    kind: ElementKind,
    x: number,
    y: number,
    content: ElementContent,
    extra?: { ref?: string; wh?: [number, number] },
  ): AddElementOp => prune({ op: "add_el", kind, xy: [x, y], content, ...extra }),

  frame: (id: string, change: { add?: string[]; remove?: string[] }): FrameOp => prune({ op: "frame", id, ...change }),
}

/**
 * Drops undefined members before the op goes on the wire.
 *
 * The server distinguishes absent from present for several fields (`set_edge`'s label absent means
 * "leave it", present-and-empty means "clear it"), and `JSON.stringify` already omits undefined, so
 * this is belt and braces for anything that inspects an op before it is serialized, such as the
 * coalescing check in the history stack.
 */
function prune<T extends object>(value: T): T {
  for (const key of Object.keys(value) as (keyof T)[]) {
    if (value[key] === undefined) {
      delete value[key]
    }
  }
  return value
}
