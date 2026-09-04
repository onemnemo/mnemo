import { useEffect, useRef, useState } from 'react';

import { navigate } from '@/app/router';
import { AppIcon } from '@/components/icon/AppIcon';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { useInlineEditor } from '@/components/ui/useInlineEditor';
import { useT } from '@/i18n/useT';
import { cn } from '@/lib/utils';
import { openNoteInPeek } from '@/peek/store';
import { useUndoDelete } from '@/trash/undo';

import {
  useCreateNote,
  useDeleteNote,
  useDeleteNoteFolder,
  useDuplicateNote,
  useSaveNoteFolder,
  useUpdateNoteMetadata,
} from '../api';
import { metadataUpdateOf } from '../note-metadata';
import { useNoteTransfer } from '../transfer/store';
import { useNoteTabs } from '../workspace/tabs';
import type { NoteFolderRowModel, NoteRowModel } from './tree-model';
import type { TreeDragHandle } from './reorder';
import type { TreeDrag } from './useNoteTreeDrag';

/** Left indent per nesting level, in px. */
export const DEPTH_INDENT = 14;

const ROW_BASE =
  'group relative flex h-7 items-center gap-1.5 rounded-md pr-1.5 text-[13.5px] leading-none outline-none cursor-pointer ' +
  'text-ink-2 transition-colors hover:bg-frame-hover hover:text-ink focus-visible:bg-frame-hover';

function useNotesT() {
  const t = useT();
  return (key: string, params?: Record<string, string | number>) => t('Notes', key, params);
}

/**
 * The vertical hairlines that trace a row back to its ancestors, one per level
 * of nesting, so a deep row still reads as belonging to the folder above it.
 */
function GuideLines({ depth }: { depth: number }) {
  if (depth === 0) return null;
  return (
    <>
      {Array.from({ length: depth }, (_, i) => (
        <span
          key={i}
          aria-hidden
          className="pointer-events-none absolute inset-y-0 w-px bg-line-soft"
          style={{ left: 12 + i * DEPTH_INDENT }}
        />
      ))}
    </>
  );
}

/**
 * The trailing favourite star, revealed on row hover and filled when the note is
 * a favourite. Never coloured, it is a state and not an alert, so it stays
 * neutral ink whether on or off, and it stays hidden at rest either way: a note's
 * membership of the Favourites section is the standing signal, so a star on every
 * favourited row would only repeat it.
 */
function FavouriteStar({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  return (
    <span
      role="button"
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      onPointerDown={(event) => event.stopPropagation()}
      className={cn(
        'hidden size-5 shrink-0 place-items-center rounded hover:bg-frame-active group-hover:grid group-focus-within:grid',
        on ? 'text-ink-2' : 'text-ink-icon',
      )}
    >
      <AppIcon name={on ? 'common/star-filled' : 'common/star'} size={13} preserveColors={false} />
    </span>
  );
}

/** A folder row: chevron, medium-weight name, and its recursive note count. */
export function FolderRow({
  row,
  onToggle,
  drag,
}: {
  row: NoteFolderRowModel;
  onToggle: (id: string) => void;
  drag: TreeDrag;
}) {
  const nt = useNotesT();
  const undo = useUndoDelete();
  const rename = useInlineEditor();
  const saveFolder = useSaveNoteFolder();
  const deleteFolder = useDeleteNoteFolder();
  const createNote = useCreateNote();
  const { folder } = row;

  const handle: TreeDragHandle = { key: `folder:${folder.id}`, kind: 'folder', id: folder.id, label: folder.name };

  const commitRename = async (name: string) => {
    rename.close();
    const trimmed = name.trim();
    if (!trimmed || trimmed === folder.name) return;
    await saveFolder.mutateAsync({ id: folder.id, name: trimmed, parentId: folder.parentId, order: folder.order });
  };

  const newNoteHere = async () => {
    const created = await createNote.mutateAsync({ folderId: folder.id });
    if (created && typeof created === 'object' && 'id' in created) navigate('notes', String(created.id));
  };

  const remove = async () => {
    undo(await deleteFolder.mutateAsync(folder.id));
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="treeitem"
          aria-expanded={row.expanded}
          tabIndex={0}
          data-row-key={handle.key}
          data-row-kind="folder"
          data-row-id={folder.id}
          data-row-depth={row.depth}
          data-row-folder={folder.id}
          onPointerDown={(event) => !rename.editing && drag.press(event, handle)}
          onClick={() => !drag.suppressClick(handle.key) && !rename.editing && onToggle(folder.id)}
          onDoubleClick={rename.open}
          onKeyDown={(event) => {
            if (rename.editing) return;
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onToggle(folder.id);
            }
          }}
          style={{ opacity: drag.sourceKey === handle.key ? 0.35 : undefined, paddingLeft: 6 + row.depth * DEPTH_INDENT }}
          className={ROW_BASE}
        >
          <GuideLines depth={row.depth} />
          <AppIcon
            name={row.expanded ? 'common/chevron-down' : 'common/chevron-right'}
            size={12}
            className="shrink-0 text-ink-icon"
          />
          {rename.editing ? (
            <RenameInput initial={folder.name} onCommit={commitRename} onCancel={rename.close} />
          ) : (
            <span className="min-w-0 flex-1 truncate" title={folder.name}>
              {folder.name}
            </span>
          )}
          {/* The count is reference, the add is the intent: swap on hover so the row
              never carries both. Everything else is on right-click. */}
          <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-ink-3 group-hover:hidden">{row.noteCount}</span>
          <span
            role="button"
            aria-label={nt('NewNote')}
            title={nt('NewNote')}
            onClick={(event) => {
              event.stopPropagation();
              void newNoteHere();
            }}
            onPointerDown={(event) => event.stopPropagation()}
            className="hidden size-5 shrink-0 place-items-center rounded text-ink-icon hover:bg-frame-active hover:text-ink group-hover:grid"
          >
            <AppIcon name="notes/compose" size={13} />
          </span>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent opensDialog={rename.opensEditor}>
        <ContextMenuItem icon="notes/compose" onSelect={() => void newNoteHere()}>
          {nt('NewNote')}
        </ContextMenuItem>
        <ContextMenuItem icon="flyout/rename" onSelect={rename.openFromMenu}>
          {nt('Rename')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem icon="common/trash" danger onSelect={() => void remove()}>
          {nt('DeleteFolder')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** A note row: a leaf, selectable, with a favourite star only in the favourites list. */
export function NoteRow({
  row,
  selected,
  drag,
  favourite = false,
}: {
  row: NoteRowModel;
  selected: boolean;
  /** Favourite rows are a flat pinned list, not part of the reorder surface. */
  drag: TreeDrag | null;
  favourite?: boolean;
}) {
  const t = useT();
  const nt = useNotesT();
  const undo = useUndoDelete();
  const rename = useInlineEditor();
  const updateNote = useUpdateNoteMetadata();
  const deleteNote = useDeleteNote();
  const duplicateNote = useDuplicateNote();
  const openTab = useNoteTabs((state) => state.open);
  const openTransfer = useNoteTransfer((state) => state.open);
  const { note } = row;

  const handle: TreeDragHandle = { key: `note:${note.id}`, kind: 'note', id: note.id, label: note.title.trim() || nt('Untitled') };

  const open = (event: React.MouseEvent) => {
    if (drag?.suppressClick(handle.key) || rename.editing) return;
    // Best effort only: most Linux window managers claim Alt plus a drag as the
    // window-move gesture, so the press can be taken before the page ever sees it.
    // Alt and Enter is the binding that always works.
    if (event.altKey) openNoteInPeek(note.id);
    else navigate('notes', note.id);
  };

  const commitRename = async (title: string) => {
    rename.close();
    const trimmed = title.trim();
    if (trimmed === note.title.trim()) return;
    await updateNote.mutateAsync(metadataUpdateOf(note, { title: trimmed }));
  };

  const toggleFavourite = () => void updateNote.mutateAsync(metadataUpdateOf(note, { isFavorite: !note.isFavorite }));

  const duplicate = async () => {
    const title = note.title.trim() || nt('Untitled');
    const copy = await duplicateNote.mutateAsync({ id: note.id, title: nt('CopyOfFormat', { 0: title }) });
    if (copy && typeof copy === 'object' && 'id' in copy) navigate('notes', String(copy.id));
  };

  const remove = async () => {
    undo(await deleteNote.mutateAsync(note.id));
  };

  const rowKey = favourite ? undefined : handle.key;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="treeitem"
          aria-selected={selected}
          tabIndex={0}
          data-row-key={rowKey}
          data-row-kind="note"
          data-row-id={note.id}
          data-row-depth={row.depth}
          data-row-folder={note.folderId ?? ''}
          onPointerDown={(event) => !favourite && !rename.editing && drag?.press(event, handle)}
          onClick={open}
          onDoubleClick={rename.open}
          onKeyDown={(event) => {
            if (rename.editing) return;
            if (event.key !== 'Enter') return;
            event.preventDefault();
            if (event.altKey) openNoteInPeek(note.id);
            else navigate('notes', note.id);
          }}
          style={{
            opacity: !favourite && drag?.sourceKey === handle.key ? 0.35 : undefined,
            paddingLeft: favourite ? 6 : 6 + row.depth * DEPTH_INDENT,
          }}
          className={cn(
            ROW_BASE,
            selected && 'bg-frame-active font-medium text-ink',
          )}
        >
          <GuideLines depth={row.depth} />
          {note.emoji ? (
            <span aria-hidden className="w-4 shrink-0 text-center text-[13px] leading-none">{note.emoji}</span>
          ) : (
            <AppIcon name="common/file-text" size={14} className="shrink-0 text-ink-icon" preserveColors={false} />
          )}
          {rename.editing ? (
            <RenameInput initial={note.title} onCommit={commitRename} onCancel={rename.close} />
          ) : (
            <span className="min-w-0 flex-1 truncate" title={note.title.trim() || nt('Untitled')}>
              {note.title.trim() || nt('Untitled')}
            </span>
          )}
          {!rename.editing ? (
            <FavouriteStar
              on={note.isFavorite}
              onToggle={toggleFavourite}
              label={note.isFavorite ? nt('Unfavourite') : nt('Favourite')}
            />
          ) : null}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent opensDialog={rename.opensEditor}>
        <ContextMenuItem icon="flyout/rename" onSelect={rename.openFromMenu}>
          {nt('Rename')}
        </ContextMenuItem>
        <ContextMenuItem icon={note.isFavorite ? 'common/star-filled' : 'common/star'} onSelect={toggleFavourite}>
          {note.isFavorite ? nt('Unfavourite') : nt('Favourite')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        {/* Opens the tab without navigating, which is the whole difference from
            clicking the row. */}
        <ContextMenuItem icon="flyout/open" onSelect={() => openTab(note.id)}>
          {nt('OpenInNewTab')}
        </ContextMenuItem>
        <ContextMenuItem icon="common/panel-right" onSelect={() => openNoteInPeek(note.id)}>
          {t('App', 'PeekOpenInSidePeek')}
        </ContextMenuItem>
        <ContextMenuItem icon="common/copy" onSelect={() => void duplicate()}>
          {nt('Duplicate')}
        </ContextMenuItem>
        <ContextMenuItem
          icon="common/upload"
          onSelect={() =>
            openTransfer({
              direction: 'export',
              scope: { label: note.title.trim() || nt('Untitled'), noteIds: [note.id] },
            })
          }
        >
          {nt('Export')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem icon="common/trash" danger onSelect={() => void remove()}>
          {nt('DeleteNote')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * The inline rename editor. It keeps the draft local so Escape genuinely reverts
 * rather than leaving a half-typed name on screen until the next reload, and it
 * stops its own presses so a rename does not arm a drag.
 */
function RenameInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const cancelled = useRef(false);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.select();
  }, []);

  return (
    <input
      ref={ref}
      value={value}
      autoFocus
      onChange={(event) => setValue(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onBlur={() => !cancelled.current && onCommit(value)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') onCommit(value);
        if (event.key === 'Escape') {
          cancelled.current = true;
          onCancel();
        }
      }}
      className="min-w-0 flex-1 bg-transparent text-[13.5px] text-ink outline-none"
    />
  );
}
