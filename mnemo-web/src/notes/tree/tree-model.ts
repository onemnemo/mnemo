import type { NoteFolderDto, NoteSummaryDto } from '@/api/types';

import { buildNoteHierarchy, storedAncestors, type NoteHierarchy } from './note-hierarchy';

/**
 * Pure derivation of the notes sidebar: nest the folders, place every note in
 * the folder that actually holds it, and flatten the result into the flat row
 * list the tree renders.
 *
 * Kept free of React so the ordering, the legacy-shape normalization and the
 * recursive counts are testable on their own. Two rules carry the persisted-data
 * contract: a folder or note whose parent no longer exists is drawn at the root
 * rather than stranded, and nothing here reads expansion or selection from disk,
 * those are handed in by the caller.
 *
 * A child page is drawn under its parent when both sit in the same folder, and
 * at the top of its own folder otherwise. `noteCount` includes nested notes.
 */

/** A note stored at the top level. A child page is drawn under its parent and never moved. */
export function isSidebarNote(note: NoteSummaryDto): boolean {
  return !note.parentNoteId;
}

export interface NoteFolderRowModel {
  kind: 'folder';
  id: string;
  depth: number;
  folder: NoteFolderDto;
  /** Full visible path, used where the folder must be distinguished outside the tree. */
  path: string;
  /** Every note drawn in this folder's subtree, nested notes and subfolders included. */
  noteCount: number;
  expanded: boolean;
}

export interface NoteRowModel {
  kind: 'note';
  id: string;
  depth: number;
  note: NoteSummaryDto;
  /** The titles above a child drawn apart from its parent, topmost first. */
  parentTitles: readonly string[];
  /** Children drawn under this note, shown or not. */
  childCount: number;
  /** Whether those children are showing. Meaningful only with children. */
  expanded: boolean;
  /** False while a search holds every match open. */
  expandable: boolean;
}

export type TreeRow = NoteFolderRowModel | NoteRowModel;

/** The key the roving tabindex, the arrow keys and React address a row by. */
export function treeKeyOf(row: TreeRow): string {
  return `${row.kind}:${row.id}`;
}

export interface NoteTree {
  /** Favourited notes, flat, newest-touched first; empty hides the section. */
  favourites: NoteSummaryDto[];
  rows: TreeRow[];
}

interface FolderNode {
  folder: NoteFolderDto;
  children: FolderNode[];
  notes: NoteSummaryDto[];
  /** Top-level notes of this folder and everything nested under them. */
  drawn: number;
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
    folders.map((f) => [f.id, { folder: f, children: [], notes: [], drawn: 0, noteCount: 0 }]),
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
    node.noteCount = node.drawn + node.children.reduce((sum, c) => sum + c.noteCount, 0);
  }
}

/** The notes drawn at the top level of a folder and its subfolders. Nested ones travel with their parent. */
export function notesInFolderSubtree(
  folderId: string,
  folders: NoteFolderDto[],
  notes: NoteSummaryDto[],
): NoteSummaryDto[] {
  const known = new Set(folders.map((f) => f.id));
  const subtree = new Set<string>();
  const pending = [folderId];
  while (pending.length > 0) {
    const id = pending.pop()!;
    if (subtree.has(id)) continue;
    subtree.add(id);
    for (const folder of folders) {
      if (effectiveParentId(folder, known) === id) pending.push(folder.id);
    }
  }
  return hierarchyOf(notes, folders).tops.filter((note) => {
    const folder = effectiveFolderId(note, known);
    return folder !== null && subtree.has(folder);
  });
}

/** The hierarchy over notes in sibling order, so every caller breaks a loop in the same place. */
export function hierarchyOf(notes: readonly NoteSummaryDto[], folders: readonly NoteFolderDto[]): NoteHierarchy {
  const known = new Set(folders.map((f) => f.id));
  return buildNoteHierarchy([...notes].sort(compareNotes), (note) => effectiveFolderId(note, known));
}

export interface BuildNoteTreeOptions {
  folders: NoteFolderDto[];
  notes: NoteSummaryDto[];
  /** From {@link hierarchyOf}. Only a change of notes or folders alters it. */
  hierarchy: NoteHierarchy;
  search: string;
  /** Folder ids the user has collapsed; folders default to expanded. */
  collapsed: ReadonlySet<string>;
  /** Note ids whose children are showing. Notes start collapsed. */
  expandedNotes: ReadonlySet<string>;
}

interface NoteRowsOptions {
  hierarchy: NoteHierarchy;
  /** Titles above a note whose stored parent is not drawn above it. */
  parentTitlesOf: (note: NoteSummaryDto) => readonly string[];
  isOpen: (id: string) => boolean;
  expandable: boolean;
  /** Limits which children are drawn. Absent draws all of them. */
  include?: ReadonlySet<string>;
}

/** A note and every note drawn under it, shown or not. */
function subtreeSize(note: NoteSummaryDto, hierarchy: NoteHierarchy): number {
  let size = 0;
  const pending = [note];
  while (pending.length > 0) {
    const current = pending.pop()!;
    size++;
    for (const child of hierarchy.childrenOf.get(current.id) ?? []) pending.push(child);
  }
  return size;
}

/** Appends each note and, while it is open, its descendants, in pre-order and without recursion. */
function pushNoteRows(rows: TreeRow[], tops: readonly NoteSummaryDto[], depth: number, options: NoteRowsOptions): void {
  const { hierarchy, parentTitlesOf, isOpen, expandable, include } = options;
  const stack = tops.map((note) => ({ note, depth })).reverse();
  while (stack.length > 0) {
    const { note, depth: level } = stack.pop()!;
    const all = hierarchy.childrenOf.get(note.id) ?? [];
    const children = include ? all.filter((child) => include.has(child.id)) : all;
    const expanded = children.length > 0 && isOpen(note.id);
    rows.push({
      kind: 'note',
      id: note.id,
      depth: level,
      note,
      parentTitles: level === depth && note.parentNoteId ? parentTitlesOf(note) : [],
      childCount: children.length,
      expanded,
      expandable,
    });
    if (!expanded) continue;
    for (let i = children.length - 1; i >= 0; i--) stack.push({ note: children[i], depth: level + 1 });
  }
}

export function buildNoteTree({
  folders,
  notes,
  hierarchy,
  search,
  collapsed,
  expandedNotes,
}: BuildNoteTreeOptions): NoteTree {
  const term = search.trim().toLowerCase();
  const known = new Set(folders.map((f) => f.id));
  let notesById: Map<string, NoteSummaryDto> | undefined;
  const parentTitlesOf = (note: NoteSummaryDto) => {
    notesById ??= new Map(notes.map((n) => [n.id, n]));
    return storedAncestors(note, notesById).map((n) => n.title.trim());
  };

  const favourites = notes
    .filter((n) => n.isFavorite)
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));

  // A search flattens the tree to the matching notes and drops folder paths. A match
  // inside a parent keeps its ancestors open so it shows whose child it is.
  if (term.length > 0) {
    const include = new Set<string>();
    for (const note of notes) {
      if (!note.title.toLowerCase().includes(term)) continue;
      for (let id: string | undefined = note.id; id !== undefined && !include.has(id); id = hierarchy.parentOf.get(id)) {
        include.add(id);
      }
    }
    const rows: TreeRow[] = [];
    pushNoteRows(rows, hierarchy.tops.filter((note) => include.has(note.id)), 0, {
      hierarchy,
      parentTitlesOf,
      isOpen: () => true,
      expandable: false,
      include,
    });
    return { favourites: [], rows };
  }

  const { roots, byId } = buildFolderNodes(folders, known);

  // Place notes in the folder that actually holds them; an orphan lands at root.
  const rootNotes: NoteSummaryDto[] = [];
  for (const note of hierarchy.tops) {
    const folderId = effectiveFolderId(note, known);
    const node = folderId ? byId.get(folderId) : undefined;
    if (node) {
      node.notes.push(note);
      node.drawn += subtreeSize(note, hierarchy);
    } else rootNotes.push(note);
  }
  applyCounts(roots);

  const rows: TreeRow[] = [];
  const noteOptions: NoteRowsOptions = { hierarchy, parentTitlesOf, isOpen: (id) => expandedNotes.has(id), expandable: true };

  // Subfolders before the folder's own notes, at any depth, matching the desktop.
  const pushFolders = (list: FolderNode[], depth: number, parentPath = '') => {
    for (const node of list) {
      const expanded = !collapsed.has(node.folder.id);
      const path = parentPath ? `${parentPath} / ${node.folder.name}` : node.folder.name;
      rows.push({
        kind: 'folder',
        id: node.folder.id,
        depth,
        folder: node.folder,
        path,
        noteCount: node.noteCount,
        expanded,
      });
      if (!expanded) continue;
      pushFolders(node.children, depth + 1, path);
      pushNoteRows(rows, node.notes, depth + 1, noteOptions);
    }
  };

  pushFolders(roots, 0);
  pushNoteRows(rows, rootNotes, 0, noteOptions);

  return { favourites, rows };
}
