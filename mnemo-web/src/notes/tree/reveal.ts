import type { NoteFolderDto, NoteSummaryDto } from '@/api/types';

import { drawnAncestors, type NoteHierarchy } from './note-hierarchy';
import { effectiveFolderId, effectiveParentId } from './tree-model';

export interface RevealTargets {
  /** Notes to expand, topmost first. */
  noteIds: string[];
  /** Folders to open, innermost first. */
  folderIds: string[];
}

/** What must open for a nested note's row to show. Empty for a top-level note. */
export function revealTargets(
  noteId: string,
  notes: readonly NoteSummaryDto[],
  folders: readonly NoteFolderDto[],
  hierarchy: NoteHierarchy,
): RevealTargets {
  const noteIds = drawnAncestors(noteId, hierarchy);
  if (noteIds.length === 0) return { noteIds, folderIds: [] };

  const known = new Set(folders.map((f) => f.id));
  const byId = new Map(folders.map((f) => [f.id, f]));
  const top = notes.find((note) => note.id === noteIds[0]);
  const folderIds: string[] = [];
  let folderId = top ? effectiveFolderId(top, known) : null;
  while (folderId !== null && !folderIds.includes(folderId)) {
    folderIds.push(folderId);
    folderId = effectiveParentId(byId.get(folderId)!, known);
  }
  return { noteIds, folderIds };
}
