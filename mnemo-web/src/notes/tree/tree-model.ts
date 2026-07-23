import type { NoteFolderDto, NoteSummaryDto } from '@/api/types';

/**
 * Pure derivation of the notes sidebar: nest the folders, place every note in
 * the folder that actually holds it, and flatten the result into the flat row
 * list the tree renders.
 *
 * Kept free of React so the ordering, the legacy-shape normalization and the
 * recursive counts are testable on their own. Two rules carry the persisted-data
 * contract: a folder or note whose parent no longer exists is drawn at the root
 * rather than stranded, and nothing here reads expansion or selection from disk,
 * those are the caller's in-memory state.
 *
 * Notes render as leaves in their folder. A note with a `parentNoteId` is a
 * child page embedded in another note, so it is left out of the sidebar
 * entirely, matching the desktop, and the field is carried through every move
 * untouched. `noteCount` and favourites see the same filtered set.
 */

/** A note the sidebar lists: a top-level note, not a page embedded in another. */
export function isSidebarNote(note: NoteSummaryDto): boolean {
  return !note.parentNoteId;
}

export interface NoteFolderRowModel {
  kind: 'folder';
  id: string;
  depth: number;
  folder: NoteFolderDto;
  /** Every note in this folder's subtree, subfolders included. */
  noteCount: number;
  expanded: boolean;
}

export interface NoteRowModel {
  kind: 'note';
  id: string;
  depth: number;
  note: NoteSummaryDto;
}

export type TreeRow = NoteFolderRowModel | NoteRowModel;

export interface NoteTree {
  /** Favourited notes, flat, newest-touched first; empty hides the section. */
  favourites: NoteSummaryDto[];
  rows: TreeRow[];
}

interface FolderNode {
  folder: NoteFolderDto;
  children: FolderNode[];
  notes: NoteSummaryDto[];
  noteCount: number;
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base' });

/** Sibling order among folders: the stored order, with name breaking ties. */
export function compareFolders(a: NoteFolderDto, b: NoteFolderDto): number {
  return a.order - b.order || collator.compare(a.name, b.name);
}

/**
 * Sibling order among notes: the stored order, then most-recently-modified, then
 * title. Mirrors the desktop, where a note with no explicit order still lands in
 * a stable, sensible place rather than jittering on every refetch.
 */
export function compareNotes(a: NoteSummaryDto, b: NoteSummaryDto): number {
  if (a.order !== b.order) return a.order - b.order;
  const byModified = b.modifiedAt.localeCompare(a.modifiedAt);
  if (byModified !== 0) return byModified;
  return collator.compare(a.title, b.title);
}

/** The folder a note actually renders in: its own, unless that folder is gone. */
export function effectiveFolderId(
  note: NoteSummaryDto,
  knownFolders: ReadonlySet<string>,
): string | null {
  return note.folderId && knownFolders.has(note.folderId) ? note.folderId : null;
}

/** The parent a folder renders under: its own, unless that parent is gone. */
export function effectiveParentId(
  folder: NoteFolderDto,
  knownFolders: ReadonlySet<string>,
): string | null {
  return folder.parentId && knownFolders.has(folder.parentId) ? folder.parentId : null;
}

function buildFolderNodes(folders: NoteFolderDto[], known: ReadonlySet<string>): {
  roots: FolderNode[];
  byId: Map<string, FolderNode>;
} {
  const byId = new Map<string, FolderNode>(
    folders.map((f) => [f.id, { folder: f, children: [], notes: [], noteCount: 0 }]),
  );

  const roots: FolderNode[] = [];
  for (const folder of folders) {
    const node = byId.get(folder.id);
    if (!node) continue;
    const parentId = effectiveParentId(folder, known);
    const parent = parentId ? byId.get(parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const sortTree = (list: FolderNode[]) => {
    list.sort((a, b) => compareFolders(a.folder, b.folder));
    for (const node of list) sortTree(node.children);
  };
  sortTree(roots);
  return { roots, byId };
}

/** Sums each folder's descendant notes. Independent of the search filter: a
 *  folder reports everything it holds even while a search hides most of it. */
function applyCounts(nodes: FolderNode[]): void {
  for (const node of nodes) {
    applyCounts(node.children);
    node.noteCount = node.notes.length + node.children.reduce((sum, c) => sum + c.noteCount, 0);
  }
}

/** Notes a search leaves in scope, by title, collapsed folders included. */
export function notesInScope(notes: NoteSummaryDto[], search: string): NoteSummaryDto[] {
  const term = search.trim().toLowerCase();
  return term.length === 0 ? notes : notes.filter((n) => n.title.toLowerCase().includes(term));
}

export interface BuildNoteTreeOptions {
  folders: NoteFolderDto[];
  notes: NoteSummaryDto[];
  search: string;
  /** Folder ids the user has collapsed; folders default to expanded. */
  collapsed: ReadonlySet<string>;
}

export function buildNoteTree({ folders, notes, search, collapsed }: BuildNoteTreeOptions): NoteTree {
  const term = search.trim().toLowerCase();
  const searching = term.length > 0;
  const known = new Set(folders.map((f) => f.id));
  // Child pages live inside their parent note, never in the sidebar; excluding
  // them here keeps them out of the rows, the favourites and the folder counts.
  const listed = notes.filter(isSidebarNote);

  const favourites = listed
    .filter((n) => n.isFavorite)
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));

  // Searching flattens the tree to just the matching notes, as the desktop does:
  // a folder path is context the sidebar drops while a query is active.
  if (searching) {
    const matches = notesInScope(listed, search).sort(compareNotes);
    return {
      favourites: [],
      rows: matches.map((note) => ({ kind: 'note', id: note.id, depth: 0, note })),
    };
  }

  const { roots, byId } = buildFolderNodes(folders, known);

  // Place notes in the folder that actually holds them; an orphan lands at root.
  const rootNotes: NoteSummaryDto[] = [];
  for (const note of listed) {
    const folderId = effectiveFolderId(note, known);
    const node = folderId ? byId.get(folderId) : undefined;
    if (node) node.notes.push(note);
    else rootNotes.push(note);
  }
  applyCounts(roots);

  const rows: TreeRow[] = [];
  const pushNote = (note: NoteSummaryDto, depth: number) =>
    rows.push({ kind: 'note', id: note.id, depth, note });

  // Subfolders before the folder's own notes, at any depth, matching the desktop.
  const pushFolders = (list: FolderNode[], depth: number) => {
    for (const node of list) {
      const expanded = !collapsed.has(node.folder.id);
      rows.push({
        kind: 'folder',
        id: node.folder.id,
        depth,
        folder: node.folder,
        noteCount: node.noteCount,
        expanded,
      });
      if (!expanded) continue;
      pushFolders(node.children, depth + 1);
      for (const note of [...node.notes].sort(compareNotes)) pushNote(note, depth + 1);
    }
  };

  pushFolders(roots, 0);
  for (const note of [...rootNotes].sort(compareNotes)) pushNote(note, 0);

  return { favourites, rows };
}
