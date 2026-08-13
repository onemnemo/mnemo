import { useMemo, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';

import { navigate } from '@/app/router';
import { AppIcon } from '@/components/icon/AppIcon';
import { Button } from '@/components/ui/button';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu';
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

const HEADER_BUTTON =
  'grid size-6 place-items-center rounded-md text-ink-icon transition-colors hover:bg-frame-hover hover:text-ink';

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
    <button type="button" aria-label={label} title={label} onClick={onClick} className={HEADER_BUTTON}>
      <AppIcon name={icon} size={14} />
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
        className="flex h-6 w-full items-center gap-1 px-2 pb-1 pt-3 text-[12px] text-ink-3 transition-colors hover:text-ink-2"
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
  failed,
  onRetry,
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
  /** The tree could not be read. Distinct from an empty tree, which means the user has no notes. */
  failed: boolean;
  onRetry: () => void;
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
      className="flex h-full flex-col border-r border-line-soft bg-canvas"
      style={{ width: SIDEBAR_WIDTH }}
    >
      <div className="flex items-center gap-1 px-2.5 pb-1.5 pt-2.5">
        <span className="flex-1 text-[13px] font-semibold text-ink">{nt('Title')}</span>
        {/* One New button with a note/folder flyout, so the header carries the
            same two intents the prototype does, plus import and collapse, rather
            than a row of single-purpose glyphs. */}
        <Menu>
          <MenuTrigger asChild>
            <button type="button" aria-label={nt('NewNote')} title={nt('NewNote')} className={HEADER_BUTTON}>
              <AppIcon name="notes/compose" size={15} />
            </button>
          </MenuTrigger>
          <MenuContent align="end">
            <MenuItem icon="notes/compose" onSelect={() => void newNote()}>
              {nt('NewNote')}
            </MenuItem>
            <MenuItem icon="common/folder" onSelect={() => void newFolder()}>
              {nt('NewFolder')}
            </MenuItem>
          </MenuContent>
        </Menu>
        <IconButton
          icon="common/download"
          label={nt('ImportNotes')}
          onClick={() => openTransfer({ direction: 'import', scope: null })}
        />
        <IconButton icon="common/layout-sidebar" label={nt('CollapseSidebar')} onClick={onCollapseSidebar} />
      </div>

      <div className="px-2.5 pb-1.5">
        <div className="flex h-7 items-center gap-1.5 rounded-md bg-canvas-sunken px-2 text-ink-3">
          <AppIcon name="common/search" size={13} className="shrink-0" />
          <input
            ref={searchInputRef}
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={nt('SearchPlaceholder')}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3"
          />
          {search ? (
            <button
              type="button"
              aria-label={nt('ClearSearch')}
              onClick={() => onSearchChange('')}
              className="shrink-0 text-ink-3 hover:text-ink-2"
            >
              <AppIcon name="common/plus" size={12} className="rotate-45" />
            </button>
          ) : (
            <span className="shrink-0 font-sans text-[10px] text-ink-3">{shortcut}</span>
          )}
        </div>
      </div>

      <div ref={scrollRef} className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {failed ? (
          // Ahead of every other branch, and worded as a failure rather than as
          // an empty tree: a read that did not answer looks exactly like a user
          // with no notes, and telling someone their notes are gone when they
          // are not is the worst thing this pane can do.
          <div
            data-testid="tree-load-failed"
            className="flex flex-col items-center gap-2 px-2 py-6 text-center"
          >
            <AppIcon name="common/triangle-alert" size={18} className="text-text-faded" />
            <p className="text-body-extra-small font-medium text-text-secondary">{nt('ListErrorTitle')}</p>
            <p className="text-body-extra-small text-text-faded">{nt('ListErrorDescription')}</p>
            <Button size="sm" variant="outline" className="mt-1" onClick={onRetry}>
              {nt('Retry')}
            </Button>
          </div>
        ) : loading ? (
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
                    className="flex h-7 w-full items-center rounded-md pl-[26px] text-[13px] text-ink-3 hover:bg-frame-hover hover:text-ink-2"
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
