import { useMemo, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';

import { navigate } from '@/app/router';
import { AppIcon } from '@/components/icon/AppIcon';
import { Skeleton } from '@/components/ui/skeleton';
import { useT } from '@/i18n/useT';
import { cn } from '@/lib/utils';
import { formatChord } from '@/keybinds/chord';
import { toast } from '@/stores/toast';
import type { NoteFolderDto, NoteSummaryDto } from '@/api/types';

import { useApplyNoteReorder, useCreateNote, useCreateNoteFolder } from '../api';
import { useNoteTransfer } from '../transfer/store';
import { buildNoteTree } from './tree-model';
import { planReorder, type ReorderPlan, type TreeDragHandle, type TreeDropTarget } from './reorder';
import { FolderRow, NoteRow } from './NoteTreeRow';
import { TreeDragLayer } from './TreeDragLayer';
import { useNoteTreeDrag } from './useNoteTreeDrag';

/** The desktop pane width, to the pixel. */
export const SIDEBAR_WIDTH = 252;

/** How many favourites show before the list folds behind a "show more" row. */
const FAVOURITES_SHOWN = 4;

function IconButton({
  icon,
  label,
  onClick,
}: {
  icon: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid size-[26px] place-items-center rounded-md text-text-secondary hover:bg-[var(--widget-background-hover)] hover:text-text-primary"
    >
      <AppIcon name={icon} size={15} />
    </button>
  );
}

/** A collapsible section heading: a rotating chevron and a muted label. */
function Section({
  label,
  open,
  onToggle,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        className="flex h-6 w-full items-center gap-1 px-2 pb-1 pt-3 text-[12px] text-text-tertiary transition-colors hover:text-text-secondary"
      >
        <AppIcon
          name="common/chevron-right"
          size={11}
          className={cn('shrink-0 transition-transform', open && 'rotate-90')}
        />
        <span>{label}</span>
      </button>
      {open ? children : null}
    </>
  );
}

/**
 * The notes sidebar: title and actions, a search field, the favourites and the
 * folder tree, and a "New note" footer. The tree is the one drag surface; the
 * favourites are a flat pinned list that does not take part in reordering.
 *
 * Selection and expansion are the caller's in-memory state, never read from
 * disk, so a reload starts from a clean, predictable tree rather than restoring
 * whatever was twirled open last session.
 */
export function NoteTreeSidebar({
  notes,
  folders,
  loading,
  selectedNoteId,
  search,
  onSearchChange,
  collapsed,
  onToggleFolder,
  onCollapseSidebar,
  searchInputRef,
}: {
  notes: NoteSummaryDto[];
  folders: NoteFolderDto[];
  loading: boolean;
  selectedNoteId?: string;
  search: string;
  onSearchChange: (value: string) => void;
  collapsed: ReadonlySet<string>;
  onToggleFolder: (id: string) => void;
  onCollapseSidebar: () => void;
  searchInputRef: RefObject<HTMLInputElement | null>;
}) {
  const t = useT();
  const nt = (key: string, params?: Record<string, string | number>) => t('Notes', key, params);

  const createNote = useCreateNote();
  const createFolder = useCreateNoteFolder();
  const applyReorder = useApplyNoteReorder();
  const openTransfer = useNoteTransfer((state) => state.open);

  const surfaceRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [favOpen, setFavOpen] = useState(true);
  const [notesOpen, setNotesOpen] = useState(true);
  const [showAllFavs, setShowAllFavs] = useState(false);

  const tree = useMemo(
    () => buildNoteTree({ notes, folders, search, collapsed }),
    [notes, folders, search, collapsed],
  );

  const shownFavs = showAllFavs ? tree.favourites : tree.favourites.slice(0, FAVOURITES_SHOWN);
  const hiddenFavs = tree.favourites.length - shownFavs.length;

  const plan = (handle: TreeDragHandle, target: TreeDropTarget): ReorderPlan | null => {
    // Planned from the orders in hand: while a move settles there is nothing to
    // plan against, so a second drop cannot renumber using figures the server
    // has already replaced.
    if (applyReorder.isPending) return null;
    const planned = planReorder(handle, target, { notes, folders });
    return planned.noteUpdates.length === 0 && planned.folderUpdates.length === 0 ? null : planned;
  };

  const onDrop = (planned: ReorderPlan) =>
    applyReorder.mutate(planned, {
      onError: () => toast.warning(nt('MoveErrorTitle'), { description: nt('MoveErrorMessage') }),
    });

  const drag = useNoteTreeDrag({ surfaceRef, scrollRef, folders, plan, onDrop });

  const newNote = async () => {
    const created = await createNote.mutateAsync({});
    if (created && typeof created === 'object' && 'id' in created) navigate('notes', String(created.id));
  };

  const newFolder = async () => {
    const rootOrder = Math.max(-1, ...folders.filter((f) => f.parentId === null).map((f) => f.order)) + 1;
    await createFolder.mutateAsync({ name: nt('NewFolderName'), parentId: null, order: rootOrder });
  };

  const shortcut = formatChord('Primary+P');
  const searching = search.trim().length > 0;

  return (
    <aside
      className="flex h-full flex-col border-r border-line bg-[var(--notes-pane-background,var(--surface))]"
      style={{ width: SIDEBAR_WIDTH }}
    >
      <div className="flex items-center justify-between px-4 pb-2.5 pt-4">
        <h2 className="text-body-medium font-semibold text-text-primary">{nt('Title')}</h2>
        <div className="flex items-center gap-0.5">
          <IconButton icon="common/plus" label={nt('NewNote')} onClick={() => void newNote()} />
          <IconButton icon="common/folder" label={nt('NewFolder')} onClick={() => void newFolder()} />
          <IconButton
            icon="common/download"
            label={nt('ImportNotes')}
            onClick={() => openTransfer({ direction: 'import', scope: null })}
          />
          <IconButton icon="common/layout-sidebar" label={nt('CollapseSidebar')} onClick={onCollapseSidebar} />
        </div>
      </div>

      <div className="px-3 pb-1">
        <div className="flex h-7 items-center gap-1.5 rounded-md border border-line bg-surface px-2 focus-within:border-[var(--accent)]">
          <AppIcon name="common/search" size={12} className="shrink-0 text-text-faded" />
          <input
            ref={searchInputRef}
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={nt('SearchPlaceholder')}
            className="min-w-0 flex-1 bg-transparent text-body-extra-small text-text-primary outline-none placeholder:text-text-faded"
          />
          {search ? (
            <button
              type="button"
              aria-label={nt('ClearSearch')}
              onClick={() => onSearchChange('')}
              className="shrink-0 text-text-faded hover:text-text-secondary"
            >
              <AppIcon name="common/plus" size={12} className="rotate-45" />
            </button>
          ) : (
            <span className="shrink-0 font-mono text-[9.5px] text-text-faded">{shortcut}</span>
          )}
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {loading ? (
          <div className="flex flex-col gap-1 px-1 pt-2">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-[22px] w-full" />
            ))}
          </div>
        ) : searching ? (
          <div ref={surfaceRef}>
            {tree.rows.length === 0 ? (
              <div className="px-2 py-6 text-center text-body-extra-small text-text-faded">
                {nt('SearchNoResults')}
              </div>
            ) : (
              tree.rows.map((row) =>
                row.kind === 'folder' ? (
                  <FolderRow key={`folder:${row.id}`} row={row} onToggle={onToggleFolder} drag={drag} />
                ) : (
                  <NoteRow key={`note:${row.id}`} row={row} selected={row.id === selectedNoteId} drag={drag} />
                ),
              )
            )}
          </div>
        ) : (
          <>
            {tree.favourites.length > 0 ? (
              <Section label={nt('Favourites')} open={favOpen} onToggle={() => setFavOpen((v) => !v)}>
                {shownFavs.map((note) => (
                  <NoteRow
                    key={`fav:${note.id}`}
                    row={{ kind: 'note', id: note.id, depth: 0, note }}
                    selected={note.id === selectedNoteId}
                    drag={null}
                    favourite
                  />
                ))}
                {hiddenFavs > 0 || showAllFavs ? (
                  <button
                    type="button"
                    onClick={() => setShowAllFavs((v) => !v)}
                    className="flex h-7 w-full items-center rounded-md pl-[26px] text-body-extra-small text-text-tertiary hover:bg-[var(--widget-background-hover)] hover:text-text-secondary"
                  >
                    {showAllFavs ? nt('ShowLess') : nt('ShowMoreCount', { 0: hiddenFavs })}
                  </button>
                ) : null}
              </Section>
            ) : null}

            <Section label={nt('MyNotes')} open={notesOpen} onToggle={() => setNotesOpen((v) => !v)}>
              <div ref={surfaceRef}>
                {tree.rows.length === 0 ? (
                  <div className="px-2 py-6 text-center text-body-extra-small text-text-faded">
                    {nt('TreeEmpty')}
                  </div>
                ) : (
                  tree.rows.map((row) =>
                    row.kind === 'folder' ? (
                      <FolderRow key={`folder:${row.id}`} row={row} onToggle={onToggleFolder} drag={drag} />
                    ) : (
                      <NoteRow key={`note:${row.id}`} row={row} selected={row.id === selectedNoteId} drag={drag} />
                    ),
                  )
                )}
              </div>
            </Section>
          </>
        )}
      </div>

      <TreeDragLayer {...drag} />
    </aside>
  );
}
