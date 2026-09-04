import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { navigate } from '@/app/router';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { useT } from '@/i18n/useT';
import { isMac } from '@/keybinds/chord';
import { usePublishTrail } from '@/nav/trail';
import { openNoteInPeek } from '@/peek/store';
import type { NoteSummaryDto } from '@/api/types';

import { useCreateNote, useNoteFoldersQuery, useNoteQuery, useNotesQuery } from '../api';
import { NotePdfExportOverlay } from '../pdf/NotePdfExportOverlay';
import { NoteTransferOverlay } from '../transfer/NoteTransferOverlay';
import { NoteTreeSidebar, SIDEBAR_WIDTH } from '../tree/NoteTreeSidebar';
import { NotePane } from './NotePane';
import { NoteTabs, type NoteTab } from './NoteTabs';
import {
  pruneCollapsedFolders,
  readCollapsedFolders,
  readLastNoteId,
  rememberCollapsedFolders,
  rememberLastNoteId,
} from './session';
import { survivingNeighbour, tabsToClose, useNoteTabs, type TabCloseScope } from './tabs';
import { SidebarExpandButton } from './SidebarExpandButton';
import { notesTrailCrumbs } from './trail';

/**
 * The notes workspace: the tree sidebar beside the editor, one surface rather
 * than a list that navigates away to a note. Which note is open and which
 * folders are shut are remembered across visits, as on the desktop; the
 * sidebar's own open state and the search are this visit's, in memory.
 */
export function NotesWorkspace({ noteId }: { noteId?: string }) {
  const t = useT();
  const nt = (key: string) => t('Notes', key);

  const notesQuery = useNotesQuery();
  const foldersQuery = useNoteFoldersQuery();
  const createNote = useCreateNote();

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(readCollapsedFolders);
  const [search, setSearch] = useState('');
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const notes = notesQuery.data ?? [];
  const folders = foldersQuery.data ?? [];
  const loading = notesQuery.isPending || foldersQuery.isPending;
  // Tracked separately from `loading`, because a failed read leaves both queries
  // settled with no data and would otherwise paint as a library with nothing in
  // it, which reads as every note being gone.
  const loadFailed = notesQuery.isError || foldersQuery.isError;

  // Only the reads that failed; a refetch of a query that succeeded would throw
  // away a good list to ask for it again.
  const retryLoad = useCallback(() => {
    if (notesQuery.isError) void notesQuery.refetch();
    if (foldersQuery.isError) void foldersQuery.refetch();
  }, [notesQuery, foldersQuery]);

  // The note's place in the tree is published to the shared topbar breadcrumb,
  // the same slot every module fills, rather than a bar of its own over the editor.
  const trail = useMemo(
    () => notesTrailCrumbs({ noteId, notes, folders, rootLabel: nt('Title'), untitled: nt('Untitled') }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [noteId, notes, folders],
  );
  usePublishTrail(trail);

  const openTabs = useNoteTabs((s) => s.ids);
  const openTab = useNoteTabs((s) => s.open);
  const dropTab = useNoteTabs((s) => s.close);
  const dropTabs = useNoteTabs((s) => s.closeMany);
  const moveTab = useNoteTabs((s) => s.move);

  // Navigating to a note opens it as a tab if it is not one already.
  useEffect(() => {
    if (noteId) openTab(noteId);
  }, [noteId, openTab]);

  // The open note is remembered so the next visit lands back on it, whether that
  // visit is a relaunch or a trip through another module.
  useEffect(() => {
    if (noteId) rememberLastNoteId(noteId);
  }, [noteId]);

  // Shares the cache entry the pane reads, so this costs no extra request. Only
  // a 404 counts as gone: a read that failed for any other reason keeps the
  // pane's retry, rather than treating a dropped connection as a deletion.
  const openNote = useNoteQuery(noteId);
  const noteGone = Boolean(noteId) && openNote.error?.status === 404;

  useEffect(() => {
    if (!noteGone || !noteId) return;
    rememberLastNoteId(null);
    dropTab(noteId);
    navigate('notes');
  }, [noteGone, noteId, dropTab]);

  // Reopening the remembered note, once per visit: closing the last tab lands
  // back here on purpose, and a second restore would undo it.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    // A note in the address bar already answers the question this is asking.
    if (noteId) {
      restored.current = true;
      return;
    }
    if (notesQuery.isPending || notesQuery.isError) return;
    restored.current = true;

    const remembered = readLastNoteId();
    if (!remembered) return;
    // Checked against the list rather than opened hopefully: a note that has
    // been deleted since should leave the empty state up, not flash a pane that
    // can only fail.
    if (!notes.some((note) => note.id === remembered)) {
      rememberLastNoteId(null);
      return;
    }
    navigate('notes', remembered);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, notes, notesQuery.isPending, notesQuery.isError]);

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

  // Closing the note you are on falls through to a neighbour rather than
  // leaving the pane empty with tabs still open beside it.
  const landOn = useCallback((fallback: string | null) => {
    if (fallback) {
      navigate('notes', fallback);
    } else {
      // Closing the last one is a decision to be on no note, so the next visit
      // should not undo it by reopening what was just closed.
      rememberLastNoteId(null);
      navigate('notes');
    }
  }, []);

  const closeTab = useCallback(
    (id: string) => {
      const ids = tabs.map((tab) => tab.id);
      dropTab(id);
      if (id !== noteId) return;
      landOn(survivingNeighbour(ids, [id], noteId));
    },
    [tabs, noteId, dropTab, landOn],
  );

  const closeTabs = useCallback(
    (id: string, scope: TabCloseScope) => {
      const ids = tabs.map((tab) => tab.id);
      const closing = tabsToClose(ids, id, scope);
      // The strip shows only the open ids the library has named, so the range is
      // taken off the store's own order as well. An id inside it with no tab yet
      // would otherwise turn into one the moment the library answers.
      dropTabs(tabsToClose(openTabs, id, scope));
      if (!noteId || !closing.includes(noteId)) return;
      landOn(survivingNeighbour(ids, closing, noteId));
    },
    [tabs, openTabs, noteId, dropTabs, landOn],
  );

  const toggleFolder = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  useEffect(() => {
    rememberCollapsedFolders(collapsed);
  }, [collapsed]);

  // A folder that has been deleted keeps no place in the stored set, which would
  // otherwise grow for the life of the install and could collapse an unrelated
  // row if an id were ever reused.
  useEffect(() => {
    const loaded = foldersQuery.data;
    if (!loaded) return;
    setCollapsed((prev) => pruneCollapsedFolders(prev, loaded.map((folder) => folder.id)));
  }, [foldersQuery.data]);

  const newNote = useCallback(async () => {
    const created = await createNote.mutateAsync({});
    if (created && typeof created === 'object' && 'id' in created) navigate('notes', String(created.id));
  }, [createNote]);

  const focusSearch = useCallback(() => {
    setSidebarOpen(true);
    // Next frame: the input may have just mounted with the sidebar.
    requestAnimationFrame(() => searchInputRef.current?.focus());
  }, []);

  // Handle app shortcuts even when the browser-default guard prevents printing on the same chord.
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
      {/* The tree slides rather than blinking out: it stays mounted at its own
          width inside a wrapper that animates to zero, so the contents keep their
          layout instead of reflowing narrower and narrower on the way out. */}
      {/* min-w-0 is load-bearing: a flex item defaults to min-width:auto, which
          holds the wrapper open at the tree's own width and the collapse does
          nothing at all. */}
      <div
        className="min-w-0 shrink-0 overflow-hidden transition-[width] motion-reduce:transition-none"
        style={{ width: sidebarOpen ? SIDEBAR_WIDTH : 0, transitionDuration: 'var(--duration-normal)' }}
        aria-hidden={!sidebarOpen}
        inert={!sidebarOpen}
      >
        <NoteTreeSidebar
          notes={notes}
          folders={folders}
          loading={loading}
          failed={loadFailed}
          onRetry={retryLoad}
          selectedNoteId={noteId}
          search={search}
          onSearchChange={setSearch}
          collapsed={collapsed}
          onToggleFolder={toggleFolder}
          onCollapseSidebar={() => setSidebarOpen(false)}
          searchInputRef={searchInputRef}
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {noteId && tabs.length > 0 ? (
          <NoteTabs
            tabs={tabs}
            activeId={noteId}
            onSelect={(id) => navigate('notes', id)}
            onClose={closeTab}
            onCloseScope={closeTabs}
            onReorder={moveTab}
            onExpandSidebar={sidebarOpen ? undefined : () => setSidebarOpen(true)}
            onOpenInPeek={openNoteInPeek}
          />
        ) : null}
        {noteId && !noteGone ? (
          <div className="min-h-0 flex-1">
            <NotePane noteId={noteId} />
          </div>
        ) : (
          <div className="relative flex h-full min-h-0 flex-col">
            {!sidebarOpen ? (
              <SidebarExpandButton onExpand={() => setSidebarOpen(true)} className="absolute left-2 top-2 z-10" />
            ) : null}
            <div className="flex flex-1 items-center justify-center">
              {loadFailed ? (
                // "Pick a note from the sidebar" is not advice that can be taken
                // when the sidebar could not be read, so the pane carries the
                // failure too rather than sending the user somewhere empty.
                <EmptyState
                  icon="common/triangle-alert"
                  title={nt('ListErrorTitle')}
                  description={nt('ListErrorDescription')}
                  action={
                    <Button size="sm" variant="outline" onClick={retryLoad}>
                      {nt('Retry')}
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  icon="common/file-text"
                  title={nt('NoNoteSelectedTitle')}
                  description={nt('NoNoteSelectedDescription')}
                />
              )}
            </div>
          </div>
        )}
      </div>

      <NoteTransferOverlay />
      <NotePdfExportOverlay />
    </div>
  );
}
