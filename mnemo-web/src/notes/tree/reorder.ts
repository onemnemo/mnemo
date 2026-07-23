import type { NoteFolderDto, NoteSummaryDto, SaveNoteFolderDto, UpdateNoteMetadataDto } from '@/api/types';

import { compareFolders, compareNotes, effectiveFolderId, effectiveParentId, isSidebarNote } from './tree-model';

/**
 * Where a tree drag would land, and the concrete writes it turns into. The
 * geometry (`resolveTreeDrop`) and the write-planning (`planReorder`) both live
 * here so the bands, the legality rules and the reindexing are readable in one
 * place, and the pointer plumbing in the drag hook carries no decisions.
 *
 * A folder nests folders and holds notes as leaves; the two carry independent
 * `order` sequences, so reindexing a note list never touches a folder's order
 * and vice versa. A move that would change nothing plans to nothing, which is
 * how the indicator stays honest: `plan` returning empty means no indicator.
 */

/** The share of a folder row, top and bottom, that reorders instead of nesting. */
export const INSERT_BAND = 0.25;

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

export type RowKind = 'folder' | 'note';

/** What a drag is carrying. `key` matches the row's `data-row-key`. */
export interface TreeDragHandle {
  key: string;
  kind: RowKind;
  id: string;
  label: string;
}

export interface MeasuredRow {
  key: string;
  kind: RowKind;
  id: string;
  depth: number;
  /** A folder row carries its own id here; a note row carries the folder holding it. */
  folderId: string | null;
  box: Box;
}

export type DropMode = 'into' | 'above' | 'below' | 'root';

export interface TreeDropTarget {
  mode: DropMode;
  /** The container the dragged row ends up in: a note's folder, a folder's parent. */
  parentId: string | null;
  /** The sibling the dragged row sits above or below; absent for into/root. */
  refId?: string;
  line?: Box;
  highlight?: Box;
}

function contains(box: Box, point: Point): boolean {
  return (
    point.x >= box.left &&
    point.x <= box.left + box.width &&
    point.y >= box.top &&
    point.y <= box.top + box.height
  );
}

/** Whether `ancestorId` sits above `folderId` on the way to the root. Cycle-safe:
 *  stored data that already loops would otherwise hang this per-move check. */
export function isFolderDescendant(
  folderId: string,
  ancestorId: string,
  folders: readonly NoteFolderDto[],
): boolean {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const seen = new Set<string>();
  let current = byId.get(folderId);
  while (current?.parentId && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.parentId === ancestorId) return true;
    current = byId.get(current.parentId);
  }
  return false;
}

/**
 * The folder row at `index` plus every visible row nested under it, as one
 * rectangle. Rows are in tree order, so the subtree ends at the first row no
 * deeper than its head.
 */
function subtreeBox(rows: readonly MeasuredRow[], index: number): Box {
  const head = rows[index];
  if (!head) return { top: 0, left: 0, width: 0, height: 0 };
  let left = head.box.left;
  let right = head.box.left + head.box.width;
  let bottom = head.box.top + head.box.height;
  for (let i = index + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.depth <= head.depth) break;
    left = Math.min(left, row.box.left);
    right = Math.max(right, row.box.left + row.box.width);
    bottom = Math.max(bottom, row.box.top + row.box.height);
  }
  return { top: head.box.top, left, width: right - left, height: bottom - head.box.top };
}

function boxBottom(box: Box): number {
  return box.top + box.height;
}

function intoFolder(folderId: string, highlight: Box): TreeDropTarget {
  return { mode: 'into', parentId: folderId, highlight };
}

function rootTarget(surface: Box): TreeDropTarget {
  return {
    mode: 'root',
    parentId: null,
    line: { top: surface.top + surface.height - 2, left: surface.left, width: surface.width, height: 2 },
  };
}

function insertBeside(
  rows: readonly MeasuredRow[],
  index: number,
  mode: 'above' | 'below',
  parentId: string | null,
): TreeDropTarget {
  const hit = rows[index];
  // Below a folder means after it and everything inside it; rows are pre-order,
  // so the row directly under an expanded folder is its first child.
  const anchor = mode === 'below' && hit?.kind === 'folder' ? boxBottom(subtreeBox(rows, index)) : hit?.box.top ?? 0;
  const bottom = mode === 'below' && hit?.kind !== 'folder' ? boxBottom(hit?.box ?? { top: 0, left: 0, width: 0, height: 0 }) : anchor;
  return {
    mode,
    parentId,
    refId: hit?.id,
    line: { top: bottom - 1, left: hit?.box.left ?? 0, width: hit?.box.width ?? 0, height: 2 },
  };
}

export interface ResolveTreeOptions {
  pointer: Point;
  rows: readonly MeasuredRow[];
  surface: Box;
  source: TreeDragHandle;
  folders: readonly NoteFolderDto[];
}

/**
 * The geometric target under the pointer, with structural illegality removed. A
 * no-op (dropping where nothing changes) is not filtered here, it falls out of
 * `planReorder` returning no writes, which the drag hook reads as "draw nothing".
 */
export function resolveTreeDrop({ pointer, rows, surface, source, folders }: ResolveTreeOptions): TreeDropTarget | null {
  if (!contains(surface, pointer)) return null;
  const known = new Set(folders.map((f) => f.id));
  const index = rows.findIndex((row) => contains(row.box, pointer));
  const hit = index < 0 ? null : rows[index];

  if (!hit) return rootTarget(surface);

  // A folder cannot land inside itself or its own subtree; every such drop would
  // strand the subtree, so it is refused rather than drawn and discarded.
  const illegalFolderNest = (parentId: string | null): boolean => {
    if (source.kind !== 'folder' || parentId === null) return false;
    return parentId === source.id || isFolderDescendant(parentId, source.id, folders);
  };

  if (hit.kind === 'note') {
    const owner = hit.folderId && known.has(hit.folderId) ? hit.folderId : null;
    if (source.kind === 'note') {
      // Reorder relative to the hovered note, inside that note's folder.
      const relative = (pointer.y - hit.box.top) / Math.max(hit.box.height, 1);
      const mode = relative < 0.5 ? 'above' : 'below';
      return insertBeside(rows, index, mode, owner);
    }
    // A folder dropped on a note nests into the folder that holds the note.
    if (illegalFolderNest(owner)) return null;
    if (!owner) return rootTarget(surface);
    const ownerIndex = rows.findIndex((r) => r.kind === 'folder' && r.id === owner);
    return intoFolder(owner, ownerIndex < 0 ? hit.box : subtreeBox(rows, ownerIndex));
  }

  // hit is a folder.
  if (source.kind === 'note') {
    // The whole folder row is one "drop into" target for a note.
    return intoFolder(hit.id, subtreeBox(rows, index));
  }

  // Folder onto folder: quarters reorder, the middle nests.
  if (hit.id === source.id) return null;
  const relative = (pointer.y - hit.box.top) / Math.max(hit.box.height, 1);
  const hitFolder = folders.find((f) => f.id === hit.id);
  const hitParent = hitFolder ? effectiveParentId(hitFolder, known) : null;

  if (relative < INSERT_BAND) {
    if (illegalFolderNest(hitParent)) return null;
    return insertBeside(rows, index, 'above', hitParent);
  }
  if (relative > 1 - INSERT_BAND) {
    if (illegalFolderNest(hitParent)) return null;
    return insertBeside(rows, index, 'below', hitParent);
  }
  if (illegalFolderNest(hit.id)) return null;
  return intoFolder(hit.id, subtreeBox(rows, index));
}

export interface ReorderPlan {
  noteUpdates: (UpdateNoteMetadataDto & { id: string })[];
  folderUpdates: (SaveNoteFolderDto & { id: string })[];
}

function insertAt<T>(list: T[], item: T, index: number): T[] {
  const next = [...list];
  next.splice(Math.max(0, Math.min(index, next.length)), 0, item);
  return next;
}

/**
 * The concrete writes a drop turns into: a compact 0..n-1 reindex of the
 * destination sibling list, emitting only the rows whose container or order
 * actually changes. Reindexing the whole list rather than nudging one order
 * keeps the result deterministic and free of fractional-order drift, and the
 * "only changed" filter keeps a reorder from rewriting a folder that did not move.
 */
export function planReorder(
  handle: TreeDragHandle,
  target: TreeDropTarget,
  data: { notes: readonly NoteSummaryDto[]; folders: readonly NoteFolderDto[] },
): ReorderPlan {
  const empty: ReorderPlan = { noteUpdates: [], folderUpdates: [] };
  const known = new Set(data.folders.map((f) => f.id));

  if (handle.kind === 'note') {
    const note = data.notes.find((n) => n.id === handle.id);
    if (!note) return empty;
    const destFolderId = target.mode === 'root' ? null : target.parentId;

    const siblings = data.notes
      .filter((n) => n.id !== note.id && isSidebarNote(n) && effectiveFolderId(n, known) === destFolderId)
      .sort(compareNotes);

    const index = insertionIndex(siblings, target);
    const ordered = insertAt(siblings, note, index);

    const updates: (UpdateNoteMetadataDto & { id: string })[] = [];
    ordered.forEach((n, order) => {
      const currentFolder = effectiveFolderId(n, known);
      if (n.id === note.id ? currentFolder === destFolderId && n.order === order : n.order === order && currentFolder === destFolderId) {
        return;
      }
      updates.push({
        id: n.id,
        title: n.title,
        folderId: destFolderId,
        parentNoteId: n.parentNoteId,
        order,
        isFavorite: n.isFavorite,
      });
    });
    return { noteUpdates: updates, folderUpdates: [] };
  }

  const folder = data.folders.find((f) => f.id === handle.id);
  if (!folder) return empty;
  const destParentId = target.mode === 'root' ? null : target.parentId;

  // Refuse a move that would strand the subtree; resolve should never offer this,
  // but planning independently means a stale target cannot slip a bad write through.
  if (destParentId === folder.id) return empty;
  if (destParentId !== null && isFolderDescendant(destParentId, folder.id, data.folders)) return empty;

  const siblings = data.folders
    .filter((f) => f.id !== folder.id && effectiveParentId(f, known) === destParentId)
    .sort(compareFolders);

  const index = insertionIndex(siblings, target);
  const ordered = insertAt(siblings, folder, index);

  const updates: (SaveNoteFolderDto & { id: string })[] = [];
  ordered.forEach((f, order) => {
    const currentParent = effectiveParentId(f, known);
    if (currentParent === destParentId && f.order === order) return;
    updates.push({ id: f.id, name: f.name, parentId: destParentId, order });
  });
  return { noteUpdates: [], folderUpdates: updates };
}

function insertionIndex(siblings: readonly { id: string }[], target: TreeDropTarget): number {
  if (target.mode === 'above' || target.mode === 'below') {
    const at = siblings.findIndex((s) => s.id === target.refId);
    if (at < 0) return siblings.length;
    return target.mode === 'above' ? at : at + 1;
  }
  return siblings.length;
}
