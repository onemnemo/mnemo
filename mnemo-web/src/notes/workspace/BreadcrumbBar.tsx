import { useMemo } from 'react';

import { navigate } from '@/app/router';
import { AppIcon } from '@/components/icon/AppIcon';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/menu';
import { useT } from '@/i18n/useT';
import { cn } from '@/lib/utils';
import { dialog } from '@/stores/dialog';
import type { NoteFolderDto, NoteSummaryDto } from '@/api/types';

import type { SaveState } from '../authority/authority';
import { useDeleteNote, useUpdateNoteMetadata } from '../api';
import { metadataUpdateOf } from '../note-metadata';
import { useNotePdf } from '../pdf/store';
import { useNoteTransfer } from '../transfer/store';
import {
  buildBreadcrumb,
  collapseBreadcrumb,
  isEllipsis,
  type BreadcrumbSegment,
} from './breadcrumb-model';
import { SaveStateIndicator } from './SaveStateIndicator';

/**
 * The 44px bar over the editor: where the note sits in the tree, and where its
 * work stands. The chain collapses to first + ellipsis + parent + current when
 * it is too deep to show whole, so the bar's width never grows with a note's
 * depth and the ends a reader needs stay put.
 */
export function BreadcrumbBar({
  note,
  notes,
  folders,
  saveState,
  onReload,
  sidebarOpen,
  onToggleSidebar,
}: {
  note: NoteSummaryDto;
  notes: NoteSummaryDto[];
  folders: NoteFolderDto[];
  saveState: SaveState;
  onReload: () => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}) {
  const t = useT();
  const nt = (key: string) => t('Notes', key);

  const pieces = useMemo(
    () => collapseBreadcrumb(buildBreadcrumb({ note, notes, folders, untitled: nt('Untitled') })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [note, notes, folders],
  );

  return (
    <div className="flex h-11 shrink-0 items-center gap-1 border-b border-divider-subtle px-3">
      {!sidebarOpen ? (
        <button
          type="button"
          aria-label={nt('ExpandSidebar')}
          title={nt('ExpandSidebar')}
          onClick={onToggleSidebar}
          className="grid size-[26px] shrink-0 place-items-center rounded-md text-text-secondary hover:bg-[var(--widget-background-hover)] hover:text-text-primary"
        >
          <AppIcon name="common/layout-sidebar" size={15} />
        </button>
      ) : null}

      <nav className="flex min-w-0 flex-1 items-center overflow-hidden" aria-label={nt('Breadcrumb')}>
        {pieces.map((piece, index) => (
          <div key={isEllipsis(piece) ? `ellipsis:${String(index)}` : `${piece.kind}:${piece.id}`} className="flex min-w-0 items-center">
            {index > 0 ? <span className="px-1 text-text-disabled">/</span> : null}
            {isEllipsis(piece) ? (
              <Menu>
                <MenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={nt('BreadcrumbMore')}
                    className="rounded px-1 text-body-extra-small text-text-tertiary hover:text-text-primary"
                  >
                    …
                  </button>
                </MenuTrigger>
                <MenuContent align="start">
                  {piece.hidden.map((seg) => (
                    <MenuItem
                      key={`${seg.kind}:${seg.id}`}
                      icon={seg.kind === 'folder' ? 'common/folder' : 'common/file-text'}
                      disabled={seg.kind === 'folder'}
                      onSelect={() => seg.kind === 'note' && navigate('notes', seg.id)}
                    >
                      {seg.label}
                    </MenuItem>
                  ))}
                </MenuContent>
              </Menu>
            ) : (
              <Crumb segment={piece} />
            )}
          </div>
        ))}
      </nav>

      <div className="flex shrink-0 items-center gap-2 pl-2">
        <SaveStateIndicator state={saveState} onReload={onReload} />
        <NoteActions note={note} />
      </div>
    </div>
  );
}

/**
 * The note's own actions, behind one glyph so the bar carries the breadcrumb
 * and nothing else, and so none of this leaks into the app's shared topbar.
 * Save state stays inline in the bar because it is quiet until it needs the
 * reader, and a menu that has to be opened would hide a conflict.
 */
function NoteActions({ note }: { note: NoteSummaryDto }) {
  const t = useT();
  const nt = (key: string, params?: Record<string, string | number>) => t('Notes', key, params);
  const updateNote = useUpdateNoteMetadata();
  const deleteNote = useDeleteNote();
  const openTransfer = useNoteTransfer((state) => state.open);
  const openPdf = useNotePdf((state) => state.open);

  const title = note.title.trim() || nt('Untitled');
  const toggleFavourite = () => void updateNote.mutateAsync(metadataUpdateOf(note, { isFavorite: !note.isFavorite }));

  const remove = async () => {
    const ok = await dialog.confirm({
      title: nt('DeleteNote'),
      message: nt('DeleteNoteConfirm', { 0: title }),
      destructive: true,
      confirmLabel: nt('DeleteNote'),
      cancelLabel: t('Common', 'Cancel'),
    });
    if (!ok) return;
    await deleteNote.mutateAsync(note.id);
    navigate('notes');
  };

  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          aria-label={nt('NoteActions')}
          title={nt('NoteActions')}
          className="grid size-7 place-items-center rounded-md text-text-tertiary hover:bg-[var(--widget-background-hover)] hover:text-text-primary aria-expanded:bg-[var(--widget-background-hover)]"
        >
          <AppIcon name="common/ellipsis" size={16} />
        </button>
      </MenuTrigger>
      <MenuContent align="end">
        <MenuItem
          icon={note.isFavorite ? 'common/star-filled' : 'common/star'}
          onSelect={toggleFavourite}
        >
          {note.isFavorite ? nt('Unfavourite') : nt('Favourite')}
        </MenuItem>
        <MenuSeparator />
        <MenuItem
          icon="common/upload"
          onSelect={() => openTransfer({ direction: 'export', scope: { label: title, noteIds: [note.id] } })}
        >
          {nt('Export')}
        </MenuItem>
        <MenuItem icon="common/download" onSelect={() => openPdf({ noteId: note.id, title })}>
          {nt('ToolbarExportPdf')}
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon="common/trash" danger onSelect={() => void remove()}>
          {nt('DeleteNote')}
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

/**
 * One crumb. A folder is context, not a destination in this port, so it is a
 * plain label; an ancestor note navigates; the current note is where you already
 * are and never a link.
 */
function Crumb({ segment }: { segment: BreadcrumbSegment }) {
  const clickable = segment.kind === 'note' && !segment.current;
  const className = cn(
    'max-w-[220px] truncate text-body-extra-small',
    segment.current ? 'font-medium text-text-primary' : 'text-text-tertiary',
    clickable && 'hover:text-text-primary',
  );

  if (clickable) {
    return (
      <button
        type="button"
        onClick={() => navigate('notes', segment.id)}
        className={className}
        title={segment.truncated ? segment.title : undefined}
      >
        {segment.label}
      </button>
    );
  }
  return (
    <span className={className} title={segment.truncated ? segment.title : undefined}>
      {segment.label}
    </span>
  );
}
