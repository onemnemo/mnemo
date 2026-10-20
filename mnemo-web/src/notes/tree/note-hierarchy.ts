import type { NoteSummaryDto } from '@/api/types';

/** Which note sits under which, as the sidebar draws it. */
export interface NoteHierarchy {
  /** Notes drawn at the top level of their folder, in input order. */
  tops: readonly NoteSummaryDto[];
  /** Direct children per drawn parent, in input order. */
  childrenOf: ReadonlyMap<string, readonly NoteSummaryDto[]>;
  /** The drawn parent of every nested note. Top-level notes have no entry. */
  parentOf: ReadonlyMap<string, string>;
}

/**
 * A note goes under its stored parent only when both sit in the same folder. A missing or
 * trashed parent, a parent in another folder or the cut point of a loop puts it at the top
 * of its own folder. Every note lands once and siblings keep the input order.
 */
export function buildNoteHierarchy(
  notes: readonly NoteSummaryDto[],
  folderOf: (note: NoteSummaryDto) => string | null,
): NoteHierarchy {
  const byId = new Map(notes.map((note) => [note.id, note]));
  const parentOf = new Map<string, string>();
  for (const note of notes) {
    const parent = note.parentNoteId && note.parentNoteId !== note.id ? byId.get(note.parentNoteId) : undefined;
    if (parent && folderOf(parent) === folderOf(note)) parentOf.set(note.id, parent.id);
  }

  const stored = new Map<string, string[]>();
  for (const [id, parentId] of parentOf) {
    const list = stored.get(parentId);
    if (list) list.push(id);
    else stored.set(parentId, [id]);
  }

  const reached = new Set<string>();
  const reach = (startId: string) => {
    const pending = [startId];
    while (pending.length > 0) {
      const id = pending.pop()!;
      if (reached.has(id)) continue;
      reached.add(id);
      for (const childId of stored.get(id) ?? []) pending.push(childId);
    }
  };

  for (const note of notes) if (!parentOf.has(note.id)) reach(note.id);
  // What is still unreached hangs off a loop. Walk up to the loop and cut it there.
  for (const note of notes) {
    if (reached.has(note.id)) continue;
    const walked = new Set<string>();
    let loopId = note.id;
    while (!walked.has(loopId)) {
      walked.add(loopId);
      loopId = parentOf.get(loopId)!;
    }
    parentOf.delete(loopId);
    reach(loopId);
  }

  const tops: NoteSummaryDto[] = [];
  const childrenOf = new Map<string, NoteSummaryDto[]>();
  for (const note of notes) {
    const parentId = parentOf.get(note.id);
    if (parentId === undefined) {
      tops.push(note);
      continue;
    }
    const list = childrenOf.get(parentId);
    if (list) list.push(note);
    else childrenOf.set(parentId, [note]);
  }
  return { tops, childrenOf, parentOf };
}

/** The drawn ancestors of a note, topmost first. Empty for a top-level note. */
export function drawnAncestors(id: string, hierarchy: Pick<NoteHierarchy, 'parentOf'>): string[] {
  const chain: string[] = [];
  let parentId = hierarchy.parentOf.get(id);
  while (parentId !== undefined) {
    chain.push(parentId);
    parentId = hierarchy.parentOf.get(parentId);
  }
  return chain.reverse();
}

/**
 * The stored parent chain of a note, topmost first. It stops at a missing parent or a
 * repeat. The breadcrumb and the tab tooltips show this chain.
 */
export function storedAncestors(
  note: NoteSummaryDto,
  notesById: ReadonlyMap<string, NoteSummaryDto>,
): NoteSummaryDto[] {
  const chain: NoteSummaryDto[] = [];
  const seen = new Set<string>([note.id]);
  let parentId = note.parentNoteId;
  while (parentId && notesById.has(parentId) && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = notesById.get(parentId)!;
    chain.push(parent);
    parentId = parent.parentNoteId;
  }
  return chain.reverse();
}
