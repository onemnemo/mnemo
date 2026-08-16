import type { FolderDto } from "@/api/types"

import { compareFolders } from "../tree"

// Where a drag would land, decided from measured rectangles and the flat folder list. Keeping
// the geometry and the legality rules here means the pointer plumbing in useLibraryDrag carries
// no decisions of its own, and the bands and thresholds are all readable in one place.

/** Pointer travel on either axis that turns a press into a drag rather than a click. */
export const DRAG_START_THRESHOLD = 5

/**
 * How far from the press the pointer must be before a drop registers at all. Measured
 * press-to-here rather than along the path, so dragging away and back reads as "never mind"
 * instead of re-homing a deck on a slip.
 *
 * Nothing is painted below this distance either: an indicator on screen always means the drop
 * on release is the one being shown.
 */
export const COMMIT_DISTANCE = 24

/** The share of a folder row, at the top and at the bottom, that reorders instead of nesting. */
export const INSERT_BAND = 0.25

export interface Point {
  x: number
  y: number
}

export interface Box {
  top: number
  left: number
  width: number
  height: number
}

export type RowKind = "folder" | "deck"

/** What a drag is carrying. `key` matches the row's `data-row-key`. */
export interface DragHandle {
  key: string
  kind: RowKind
  id: string
  /** The folder holding it today: a deck's folder, a folder's parent. Null at the root. */
  parentId: string | null
  label: string
  /** The "3 decks" / "12 cards" line the ghost shows beside the name. */
  subtitle: string
}

export interface MeasuredRow {
  key: string
  kind: RowKind
  id: string
  depth: number
  /** A folder row carries its own id here; a deck row carries the folder holding it. */
  folderId: string | null
  box: Box
}

export type DropMode = "into" | "above" | "below" | "root"

export interface DropTarget {
  mode: DropMode
  /** The folder to nest into, or the sibling to sit above/below. Null only for the root drop. */
  folderId: string | null
  /** The parent the dragged row ends up under once this drop is applied. */
  parentId: string | null
  line?: Box
  highlight?: Box
}

function contains(box: Box, point: Point): boolean {
  return (
    point.x >= box.left &&
    point.x <= box.left + box.width &&
    point.y >= box.top &&
    point.y <= box.top + box.height
  )
}

/**
 * The parent a row actually renders under. A folder whose parent no longer exists is drawn at
 * the root by the tree builder, so every rule here has to agree with that: reading the stored
 * id instead would write rows straight back under the missing folder, where only this app's own
 * normalization keeps them visible.
 */
export function effectiveParent(
  parentId: string | null | undefined,
  known: ReadonlySet<string>,
): string | null {
  return parentId && known.has(parentId) ? parentId : null
}

/**
 * Whether `ancestorId` sits somewhere above `folderId` on the way to the root.
 * The visited set is not for correctness but for survival: stored data that already contains a
 * cycle would otherwise hang the loop, and this runs on every pointer move.
 */
export function isDescendant(
  folderId: string,
  ancestorId: string,
  folders: readonly FolderDto[],
): boolean {
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  const seen = new Set<string>()
  let current = byId.get(folderId)
  while (current?.parentId && !seen.has(current.id)) {
    seen.add(current.id)
    if (current.parentId === ancestorId) return true
    current = byId.get(current.parentId)
  }
  return false
}

/**
 * The folder row at `index` plus every visible row nested under it, as one rectangle. Rows are
 * in tree order, so the subtree ends at the first row that is not deeper than its head.
 */
function subtreeBox(rows: readonly MeasuredRow[], index: number): Box {
  const head = rows[index]
  if (!head) return { top: 0, left: 0, width: 0, height: 0 }

  let left = head.box.left
  let right = head.box.left + head.box.width
  let bottom = head.box.top + head.box.height

  for (let i = index + 1; i < rows.length; i++) {
    const row = rows[i]
    if (!row || row.depth <= head.depth) break
    left = Math.min(left, row.box.left)
    right = Math.max(right, row.box.left + row.box.width)
    bottom = Math.max(bottom, row.box.top + row.box.height)
  }

  return { top: head.box.top, left, width: right - left, height: bottom - head.box.top }
}

function intoTarget(folderId: string, highlight: Box): DropTarget {
  return { mode: "into", folderId, parentId: folderId, highlight }
}

/** A line across the bottom of the whole card: out of every folder, at the end of the list. */
function rootTarget(surface: Box): DropTarget {
  return {
    mode: "root",
    folderId: null,
    parentId: null,
    line: { top: surface.top + surface.height - 2, left: surface.left, width: surface.width, height: 2 },
  }
}

function insertTarget(
  rows: readonly MeasuredRow[],
  index: number,
  mode: "above" | "below",
  folders: readonly FolderDto[],
  known: ReadonlySet<string>,
): DropTarget | null {
  const hit = rows[index]
  const target = hit && folders.find((folder) => folder.id === hit.id)
  if (!hit || !target) return null

  // Below means "after this folder and everything inside it". Rows are pre-order, so the row
  // directly under an expanded folder is its first child - drawing the line there would promise
  // a gap the dropped folder does not land in.
  const bottom = mode === "below" ? boxBottom(subtreeBox(rows, index)) : hit.box.top

  return {
    mode,
    folderId: hit.id,
    // Inserting makes the dragged folder a *sibling* of the hovered one, so the parent it ends
    // up under is the hovered folder's parent - not the hovered folder.
    parentId: effectiveParent(target.parentId, known),
    line: { top: bottom - 1, left: hit.box.left, width: hit.box.width, height: 2 },
  }
}

function boxBottom(box: Box): number {
  return box.top + box.height
}

/**
 * Drops that would change nothing, or that would cut a subtree out of the tree, resolve to no
 * target at all. The desktop paints a valid-looking indicator for these and then silently
 * discards the drop, which reads as the feature being broken.
 */
function legal(
  target: DropTarget | null,
  source: DragHandle,
  folders: readonly FolderDto[],
  known: ReadonlySet<string>,
): DropTarget | null {
  if (!target) return null
  const sourceParent = effectiveParent(source.parentId, known)

  if (source.kind === "deck") {
    // Decks carry no order of their own in the tree, so landing back in the folder a deck
    // already sits in would be a write with nothing to show for it.
    return target.parentId === sourceParent ? null : target
  }

  // A folder can be neither its own parent nor a child of its own descendant. Either one
  // strands the whole subtree - every nested folder and every deck inside them - because the
  // tree is only ever walked downwards from the root.
  if (target.parentId === source.id) return null
  if (target.parentId !== null && isDescendant(target.parentId, source.id, folders)) return null

  // Nesting into the folder it already sits in would only shuffle it to the end of a list it is
  // already in - the same non-move the deck rule refuses above, and on screen indistinguishable
  // from a real nest.
  if (target.mode === "into" && target.parentId === sourceParent) return null

  // Dropping past the last row means "put it at the end of the root list". For a folder already
  // at the root that is still a real reorder - unless it is the one already sitting last.
  if (target.mode === "root" && sourceParent === null) {
    const roots = folders.filter((f) => effectiveParent(f.parentId, known) === null).sort(compareFolders)
    if (roots[roots.length - 1]?.id === source.id) return null
  }

  return target
}

export interface ResolveOptions {
  pointer: Point
  rows: readonly MeasuredRow[]
  surface: Box
  source: DragHandle
  folders: readonly FolderDto[]
}

export function resolveDropTarget({
  pointer,
  rows,
  surface,
  source,
  folders,
}: ResolveOptions): DropTarget | null {
  // Off the card entirely is a no-op, which is deliberately not the same as the root drop.
  if (!contains(surface, pointer)) return null

  const known = new Set(folders.map((folder) => folder.id))
  const index = rows.findIndex((row) => contains(row.box, pointer))
  const hit = index < 0 ? null : rows[index]

  // Over the card but over no row - the column header, the totals footer, the gap under the
  // last row - reads as "out of every folder".
  if (!hit) return legal(rootTarget(surface), source, folders, known)

  // A folder's whole block is one target: hovering a deck inside it means the folder that
  // holds it. There is no dropping between two decks, because deck order is not what the tree
  // sorts by and the move would be invisible.
  if (hit.kind === "deck") {
    const owner = effectiveParent(hit.folderId, known)
    if (!owner) return legal(rootTarget(surface), source, folders, known)
    const ownerRow = rows.findIndex((row) => row.kind === "folder" && row.id === owner)
    const highlight = ownerRow < 0 ? hit.box : subtreeBox(rows, ownerRow)
    return legal(intoTarget(owner, highlight), source, folders, known)
  }

  if (source.kind === "deck") {
    return legal(intoTarget(hit.id, subtreeBox(rows, index)), source, folders, known)
  }

  if (hit.id === source.id) return null

  // Folder onto folder: the top and bottom quarters reorder, the middle nests.
  const relative = (pointer.y - hit.box.top) / Math.max(hit.box.height, 1)
  if (relative < INSERT_BAND) return legal(insertTarget(rows, index, "above", folders, known), source, folders, known)
  if (relative > 1 - INSERT_BAND) return legal(insertTarget(rows, index, "below", folders, known), source, folders, known)
  return legal(intoTarget(hit.id, subtreeBox(rows, index)), source, folders, known)
}
