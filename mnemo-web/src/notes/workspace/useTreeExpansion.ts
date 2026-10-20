import { useCallback, useEffect, useRef, useState } from 'react';

import type { NoteFolderDto, NoteSummaryDto } from '@/api/types';

import type { NoteHierarchy } from '../tree/note-hierarchy';
import { revealTargets } from '../tree/reveal';
import {
  pruneCollapsedFolders,
  pruneExpandedNotes,
  readCollapsedFolders,
  readExpandedNotes,
  rememberCollapsedFolders,
  rememberExpandedNotes,
} from './session';

function toggled(ids: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(ids);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/**
 * Which folders are shut and which notes are open in the sidebar, kept across visits.
 * Opening a nested note unfolds the way to it once, so it can be folded again.
 */
export function useTreeExpansion({
  noteId,
  notes,
  folders,
  hierarchy,
}: {
  noteId?: string;
  /** Undefined until the library has answered. */
  notes?: readonly NoteSummaryDto[];
  folders?: readonly NoteFolderDto[];
  hierarchy?: NoteHierarchy;
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(readCollapsedFolders);
  const [expandedNotes, setExpandedNotes] = useState<ReadonlySet<string>>(readExpandedNotes);

  const toggleFolder = useCallback((id: string) => setCollapsed((prev) => toggled(prev, id)), []);
  const toggleNote = useCallback((id: string) => setExpandedNotes((prev) => toggled(prev, id)), []);

  useEffect(() => {
    rememberCollapsedFolders(collapsed);
  }, [collapsed]);

  useEffect(() => {
    rememberExpandedNotes(expandedNotes);
  }, [expandedNotes]);

  // Drop deleted ids so the stored sets do not grow forever or match a reused id.
  useEffect(() => {
    if (folders) setCollapsed((prev) => pruneCollapsedFolders(prev, folders.map((folder) => folder.id)));
  }, [folders]);

  useEffect(() => {
    if (notes) setExpandedNotes((prev) => pruneExpandedNotes(prev, notes.map((note) => note.id)));
  }, [notes]);

  const revealedFor = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!noteId) {
      revealedFor.current = undefined;
      return;
    }
    if (!notes || !folders || !hierarchy || revealedFor.current === noteId) return;
    if (!notes.some((note) => note.id === noteId)) return;
    revealedFor.current = noteId;

    const { noteIds, folderIds } = revealTargets(noteId, notes, folders, hierarchy);
    setExpandedNotes((prev) => (noteIds.every((id) => prev.has(id)) ? prev : new Set([...prev, ...noteIds])));
    setCollapsed((prev) => {
      if (!folderIds.some((id) => prev.has(id))) return prev;
      return new Set([...prev].filter((id) => !folderIds.includes(id)));
    });
  }, [noteId, notes, folders, hierarchy]);

  return { collapsed, expandedNotes, toggleFolder, toggleNote };
}
