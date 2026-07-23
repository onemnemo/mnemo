import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { navigate } from '@/app/router';
import { AppIcon } from '@/components/icon/AppIcon';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/menu';
import { useT } from '@/i18n/useT';
import { cn } from '@/lib/utils';
import { dialog } from '@/stores/dialog';

import {
  useCreateNote,
  useDeleteNote,
  useDeleteNoteFolder,
  useSaveNoteFolder,
  useUpdateNoteMetadata,
} from '../api';
import { metadataUpdateOf } from '../note-metadata';
import type { NoteFolderRowModel, NoteRowModel } from './tree-model';
import type { TreeDragHandle } from './reorder';
import type { TreeDrag } from './useNoteTreeDrag';

/** Left indent per nesting level, in px. */
export const DEPTH_INDENT = 12;

const ROW_BASE =
  'group flex h-[28px] items-center gap-1 rounded-md pr-1 outline-none cursor-pointer ' +
  'hover:bg-[var(--widget-background-hover)] focus-visible:bg-[var(--widget-background-hover)]';

function useNotesT() {
  const t = useT();
  return (key: string, params?: Record<string, string | number>) => t('Notes', key, params);
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
  const t = useT();
  const [editing, setEditing] = useState(false);
  const saveFolder = useSaveNoteFolder();
  const deleteFolder = useDeleteNoteFolder();
  const createNote = useCreateNote();
  const { folder } = row;

  const handle: TreeDragHandle = { key: `folder:${folder.id}`, kind: 'folder', id: folder.id, label: folder.name };

  const commitRename = async (name: string) => {
    setEditing(false);
    const trimmed = name.trim();
    if (!trimmed || trimmed === folder.name) return;
    await saveFolder.mutateAsync({ id: folder.id, name: trimmed, parentId: folder.parentId, order: folder.order });
  };

  const newNoteHere = async () => {
    const created = await createNote.mutateAsync({ folderId: folder.id });
    if (created && typeof created === 'object' && 'id' in created) navigate('notes', String(created.id));
  };

  const remove = async () => {
    const ok = await dialog.confirm({
      title: nt('DeleteFolder'),
      message: nt('DeleteFolderConfirm', { 0: folder.name }),
      destructive: true,
      confirmLabel: nt('DeleteFolder'),
      cancelLabel: t('Common', 'Cancel'),
    });
    if (ok) await deleteFolder.mutateAsync(folder.id);
  };

  return (
    <div
      role="treeitem"
      aria-expanded={row.expanded}
      tabIndex={0}
      data-row-key={handle.key}
      data-row-kind="folder"
      data-row-id={folder.id}
      data-row-depth={row.depth}
      data-row-folder={folder.id}
      onPointerDown={(event) => !editing && drag.press(event, handle)}
      onClick={() => !drag.suppressClick(handle.key) && !editing && onToggle(folder.id)}
      onDoubleClick={() => setEditing(true)}
      onKeyDown={(event) => {
        if (editing) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onToggle(folder.id);
        }
      }}
      style={{ opacity: drag.sourceKey === handle.key ? 0.35 : undefined, paddingLeft: 4 + row.depth * DEPTH_INDENT }}
      className={ROW_BASE}
    >
      <AppIcon
        name={row.expanded ? 'common/chevron-down' : 'common/chevron-right'}
        size={10}
        className="shrink-0 text-text-faded"
      />
      {editing ? (
        <RenameInput initial={folder.name} onCommit={commitRename} onCancel={() => setEditing(false)} />
      ) : (
        <span className="min-w-0 flex-1 truncate text-body-extra-small font-medium text-text-primary" title={folder.name}>
          {folder.name}
        </span>
      )}
      <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-text-faded">{row.noteCount}</span>
      <RowMenu label={nt('FolderActions')}>
        <MenuItem icon="common/plus" onSelect={() => void newNoteHere()}>
          {nt('NewNote')}
        </MenuItem>
        <MenuItem icon="flyout/rename" onSelect={() => setEditing(true)}>
          {nt('Rename')}
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon="common/trash" danger onSelect={() => void remove()}>
          {nt('DeleteFolder')}
        </MenuItem>
      </RowMenu>
    </div>
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
  const nt = useNotesT();
  const t = useT();
  const [editing, setEditing] = useState(false);
  const updateNote = useUpdateNoteMetadata();
  const deleteNote = useDeleteNote();
  const { note } = row;

  const handle: TreeDragHandle = { key: `note:${note.id}`, kind: 'note', id: note.id, label: note.title.trim() || nt('Untitled') };

  const open = () => {
    if (drag?.suppressClick(handle.key) || editing) return;
    navigate('notes', note.id);
  };

  const commitRename = async (title: string) => {
    setEditing(false);
    const trimmed = title.trim();
    if (trimmed === note.title.trim()) return;
    await updateNote.mutateAsync(metadataUpdateOf(note, { title: trimmed }));
  };

  const toggleFavourite = () => void updateNote.mutateAsync(metadataUpdateOf(note, { isFavorite: !note.isFavorite }));

  const remove = async () => {
    const ok = await dialog.confirm({
      title: nt('DeleteNote'),
      message: nt('DeleteNoteConfirm', { 0: note.title.trim() || nt('Untitled') }),
      destructive: true,
      confirmLabel: nt('DeleteNote'),
      cancelLabel: t('Common', 'Cancel'),
    });
    if (ok) await deleteNote.mutateAsync(note.id);
  };

  const rowKey = favourite ? undefined : handle.key;

  return (
    <div
      role="treeitem"
      aria-selected={selected}
      tabIndex={0}
      data-row-key={rowKey}
      data-row-kind="note"
      data-row-id={note.id}
      data-row-depth={row.depth}
      data-row-folder={note.folderId ?? ''}
      onPointerDown={(event) => !favourite && !editing && drag?.press(event, handle)}
      onClick={open}
      onDoubleClick={() => setEditing(true)}
      onKeyDown={(event) => {
        if (editing) return;
        if (event.key === 'Enter') {
          event.preventDefault();
          navigate('notes', note.id);
        }
      }}
      style={{
        opacity: !favourite && drag?.sourceKey === handle.key ? 0.35 : undefined,
        paddingLeft: favourite ? 6 : 4 + row.depth * DEPTH_INDENT,
      }}
      className={cn(
        ROW_BASE,
        selected && 'bg-[var(--widget-background-hover)]',
      )}
    >
      <AppIcon
        name={favourite ? 'common/star' : 'common/file-text'}
        size={13}
        className={cn('shrink-0', favourite ? 'text-[var(--accent)]' : 'text-text-faded')}
        preserveColors={false}
      />
      {editing ? (
        <RenameInput initial={note.title} onCommit={commitRename} onCancel={() => setEditing(false)} />
      ) : (
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-body-extra-small',
            selected ? 'font-medium text-text-primary' : 'text-text-secondary',
          )}
          title={note.title.trim() || nt('Untitled')}
        >
          {note.title.trim() || nt('Untitled')}
        </span>
      )}
      <RowMenu label={nt('NoteActions')}>
        <MenuItem icon="flyout/rename" onSelect={() => setEditing(true)}>
          {nt('Rename')}
        </MenuItem>
        <MenuItem icon={note.isFavorite ? 'common/star-filled' : 'common/star'} onSelect={toggleFavourite}>
          {note.isFavorite ? nt('Unfavourite') : nt('Favourite')}
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon="common/trash" danger onSelect={() => void remove()}>
          {nt('DeleteNote')}
        </MenuItem>
      </RowMenu>
    </div>
  );
}

function RowMenu({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
      <Menu>
        <MenuTrigger asChild>
          <button
            type="button"
            aria-label={label}
            title={label}
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            className="grid size-5 place-items-center rounded text-text-faded hover:bg-surface-subtle hover:text-text-secondary"
          >
            <AppIcon name="common/dots-vertical" size={14} />
          </button>
        </MenuTrigger>
        <MenuContent align="end">{children}</MenuContent>
      </Menu>
    </div>
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
      className="min-w-0 flex-1 bg-transparent text-body-extra-small text-text-primary outline-none"
    />
  );
}
