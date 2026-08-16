import type { NoteFolderDto, NoteSummaryDto } from '@/api/types';

/**
 * The note's place in the tree, as a chain of crumbs, and how that chain
 * collapses when it is too deep to show whole.
 *
 * The chain is the folder path from the root down to the note's folder, then
 * the note's own parent-page chain, then the note itself, matching the desktop.
 * Building it is a pure walk of the folder and note lists, cycle-safe because
 * persisted data can already contain a loop; the collapse is a separate pure
 * step so the "which crumbs survive an overflow" rule can be tested on its own,
 * without measuring any pixels.
 */

/** Per-crumb character cap; longer titles are cut with an ellipsis and a tooltip. */
export const MAX_SEGMENT_CHARS = 28;

/** Crumbs shown before the chain collapses to first + ellipsis + parent + current. */
export const MAX_VISIBLE_ITEMS = 4;

export interface BreadcrumbSegment {
  kind: 'folder' | 'note';
  id: string;
  /** The full title, for the tooltip. */
  title: string;
  /** The title as shown, truncated to {@link MAX_SEGMENT_CHARS}. */
  label: string;
  truncated: boolean;
  /** The note being edited: the last crumb, never a link. */
  current: boolean;
}

export interface EllipsisPiece {
  kind: 'ellipsis';
  /** The crumbs folded away, in order, for the overflow menu. */
  hidden: BreadcrumbSegment[];
}

export type BreadcrumbPiece = BreadcrumbSegment | EllipsisPiece;

function truncate(title: string): { label: string; truncated: boolean } {
  if (title.length <= MAX_SEGMENT_CHARS) return { label: title, truncated: false };
  return { label: `${title.slice(0, MAX_SEGMENT_CHARS).trimEnd()}…`, truncated: true };
}

function segment(kind: 'folder' | 'note', id: string, title: string, current: boolean): BreadcrumbSegment {
  return { kind, id, title, ...truncate(title), current };
}

export interface BuildBreadcrumbOptions {
  note: NoteSummaryDto;
  folders: readonly NoteFolderDto[];
  notes: readonly NoteSummaryDto[];
  /** Title for a note with none, so a blank crumb never renders empty. */
  untitled: string;
}

export function buildBreadcrumb({ note, folders, notes, untitled }: BuildBreadcrumbOptions): BreadcrumbSegment[] {
  const foldersById = new Map(folders.map((f) => [f.id, f]));
  const notesById = new Map(notes.map((n) => [n.id, n]));
  const titleOf = (n: NoteSummaryDto) => n.title.trim() || untitled;

  // Folder path, root first. Cycle-safe: a looped parentId would otherwise hang.
  const folderChain: BreadcrumbSegment[] = [];
  const seenFolders = new Set<string>();
  let folderId = note.folderId;
  while (folderId && foldersById.has(folderId) && !seenFolders.has(folderId)) {
    seenFolders.add(folderId);
    const folder = foldersById.get(folderId)!;
    folderChain.unshift(segment('folder', folder.id, folder.name.trim() || untitled, false));
    folderId = folder.parentId;
  }

  // Parent-page path, topmost first, not including the current note.
  const noteChain: BreadcrumbSegment[] = [];
  const seenNotes = new Set<string>([note.id]);
  let parentId = note.parentNoteId;
  while (parentId && notesById.has(parentId) && !seenNotes.has(parentId)) {
    seenNotes.add(parentId);
    const parent = notesById.get(parentId)!;
    noteChain.unshift(segment('note', parent.id, titleOf(parent), false));
    parentId = parent.parentNoteId;
  }

  return [...folderChain, ...noteChain, segment('note', note.id, titleOf(note), true)];
}

/**
 * Folds a chain too deep to show. At or under the cap every crumb shows; past
 * it, only the first crumb, an ellipsis holding the middle, the immediate parent
 * and the current note survive, so the ends a reader needs stay put and the
 * bar's width stops growing with the note's depth.
 */
export function collapseBreadcrumb(
  segments: readonly BreadcrumbSegment[],
  maxVisible: number = MAX_VISIBLE_ITEMS,
): BreadcrumbPiece[] {
  if (segments.length <= maxVisible) return [...segments];

  const first = segments[0];
  const parent = segments[segments.length - 2];
  const current = segments[segments.length - 1];
  const hidden = segments.slice(1, segments.length - 2);

  return [first, { kind: 'ellipsis', hidden }, parent, current];
}

export function isEllipsis(piece: BreadcrumbPiece): piece is EllipsisPiece {
  return piece.kind === 'ellipsis';
}
