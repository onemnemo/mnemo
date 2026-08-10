import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { navigate } from '@/app/router';
import { EmptyState } from '@/components/ui/empty-state';
import { useT } from '@/i18n/useT';
import { isMac } from '@/keybinds/chord';
import { usePublishTrail } from '@/nav/trail';
import type { NoteSummaryDto } from '@/api/types';

import { useCreateNote, useNoteFoldersQuery, useNotesQuery } from '../api';
import { NotePdfExportOverlay } from '../pdf/NotePdfExportOverlay';
import { NoteTransferOverlay } from '../transfer/NoteTransferOverlay';
import { NoteTreeSidebar } from '../tree/NoteTreeSidebar';
import { NotePane } from './NotePane';
import { NoteTabs, type NoteTab } from './NoteTabs';
import { SidebarExpandButton } from './SidebarExpandButton';
import { notesTrailCrumbs } from './trail';

/**
 * The notes workspace: the tree sidebar beside the editor, one surface rather
 * than a list that navigates away to a note. The sidebar's open state, the
 * collapsed folders and the search live here, in memory, never read from disk,
 * so a reload starts from a clean, predictable tree.
 */
export function NotesWorkspace({ noteId }: { noteId?: string }) {
  const t = useT();
  const nt = (key: string) => t('Notes', key);

  const notesQuery = useNotesQuery();
  const foldersQuery = useNoteFoldersQuery();
  const createNote = useCreateNote();

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [search, setSearch] = useState('');
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const notes = notesQuery.data ?? [];
  const folders = foldersQuery.data ?? [];
  const loading = notesQuery.isPending || foldersQuery.isPending;

  // The note's place in the tree is published to the shared topbar breadcrumb,
  // the same slot every module fills, rather than a bar of its own over the editor.
  const trail = useMemo(
    () => notesTrailCrumbs({ noteId, notes, folders, rootLabel: nt('Title'), untitled: nt('Untitled') }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [noteId, notes, folders],
  );
  usePublishTrail(trail);

  // Which notes are open as tabs, in the order they were opened. In memory only,
  // like the tree's own state, so a reload starts from just the open note.
  const [openTabs, setOpenTabs] = useState<string[]>(() => (noteId ? [noteId] : []));
  useEffect(() => {
    if (!noteId) return;
    setOpenTabs((prev) => (prev.includes(noteId) ? prev : [...prev, noteId]));
  }, [noteId]);

  // Rendered tabs: the open ids that still name a real note, titled and iconed
  // from the summaries, so a deleted note drops out rather than showing a stub.
  const tabs = useMemo<NoteTab[]>(
    () =>
      openTabs
        .map((id) => notes.find((note) => note.id === id))
        .filter((note): note is NoteSummaryDto => note !== undefined)
        .map((note) => ({ id: note.id, title: note.title.trim() || nt('Untitled'), emoji: note.emoji })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [openTabs, notes],
  );

  const closeTab = useCallback(
    (id: string) => {
      const ids = tabs.map((tab) => tab.id);
      const index = ids.indexOf(id);
      setOpenTabs((prev) => prev.filter((tabId) => tabId !== id));
      if (id !== noteId) return;
      const fallback = ids[index + 1] ?? ids[index - 1] ?? null;
      if (fallback) navigate('notes', fallback);
      else navigate('notes');
    },
    [tabs, noteId],
  );

  const toggleFolder = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const newNote = useCallback(async () => {
    const created = await createNote.mutateAsync({});
    if (created && typeof created === 'object' && 'id' in created) navigate('notes', String(created.id));
  }, [createNote]);

  const focusSearch = useCallback(() => {
    setSidebarOpen(true);
    // Next frame: the input may have just mounted with the sidebar.
    requestAnimationFrame(() => searchInputRef.current?.focus());
  }, []);

  // Ctrl/Cmd+N new note, Ctrl/Cmd+P focus search, matching the desktop.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const primary = isMac ? event.metaKey : event.ctrlKey;
      if (!primary || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === 'n') {
        event.preventDefault();
        void newNote();
      } else if (key === 'p') {
        event.preventDefault();
        focusSearch();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [newNote, focusSearch]);

  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden">
      {sidebarOpen ? (
        <NoteTreeSidebar
          notes={notes}
          folders={folders}
          loading={loading}
          selectedNoteId={noteId}
          search={search}
          onSearchChange={setSearch}
          collapsed={collapsed}
          onToggleFolder={toggleFolder}
          onCollapseSidebar={() => setSidebarOpen(false)}
          searchInputRef={searchInputRef}
        />
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        {noteId && tabs.length > 0 ? (
          <NoteTabs
            tabs={tabs}
            activeId={noteId}
            onSelect={(id) => navigate('notes', id)}
            onClose={closeTab}
            onExpandSidebar={sidebarOpen ? undefined : () => setSidebarOpen(true)}
          />
        ) : null}
        {noteId ? (
          <div className="min-h-0 flex-1">
            <NotePane noteId={noteId} />
          </div>
        ) : (
          <div className="relative flex h-full min-h-0 flex-col">
            {!sidebarOpen ? (
              <SidebarExpandButton onExpand={() => setSidebarOpen(true)} className="absolute left-2 top-2 z-10" />
            ) : null}
            <div className="flex flex-1 items-center justify-center">
              <EmptyState icon="common/file-text" title={nt('NoNoteSelectedTitle')} description={nt('NoNoteSelectedDescription')} />
            </div>
          </div>
        )}
      </div>

      <NoteTransferOverlay />
      <NotePdfExportOverlay />
    </div>
  );
}
