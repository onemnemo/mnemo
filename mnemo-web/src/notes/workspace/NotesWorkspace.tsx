import { useCallback, useEffect, useRef, useState } from 'react';

import { navigate } from '@/app/router';
import { EmptyState } from '@/components/ui/empty-state';
import { useT } from '@/i18n/useT';
import { isMac } from '@/keybinds/chord';

import { useCreateNote, useNoteFoldersQuery, useNotesQuery } from '../api';
import { NoteTreeSidebar } from '../tree/NoteTreeSidebar';
import { NotePane } from './NotePane';

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

      <div className="min-w-0 flex-1">
        {noteId ? (
          <NotePane
            noteId={noteId}
            notes={notes}
            folders={folders}
            sidebarOpen={sidebarOpen}
            onToggleSidebar={() => setSidebarOpen((open) => !open)}
          />
        ) : (
          <div className="flex h-full min-h-0 flex-col">
            {!sidebarOpen ? <div className="h-11 shrink-0 border-b border-divider-subtle" /> : null}
            <div className="flex flex-1 items-center justify-center">
              <EmptyState icon="common/file-text" title={nt('NoNoteSelectedTitle')} description={nt('NoNoteSelectedDescription')} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
