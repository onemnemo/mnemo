import { navigate } from '@/app/router';
import { AppIcon } from '@/components/icon/AppIcon';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/menu';
import { useT } from '@/i18n/useT';
import { cn } from '@/lib/utils';
import { dialog } from '@/stores/dialog';
import type { NoteSummaryDto } from '@/api/types';

import { useDeleteNote, useUpdateNoteMetadata } from '../api';
import { metadataUpdateOf } from '../note-metadata';
import { useNotePdf } from '../pdf/store';
import { useNoteTransfer } from '../transfer/store';
import { coverCss } from './covers';

/**
 * The note's own actions, behind one glyph pinned to the top-right of the pane
 * rather than a toolbar row: it costs no vertical space and stays put while the
 * document scrolls. Hidden until the pointer enters the pane, the same contract
 * as the block gutter, so the reading surface comes first. Over a cover it takes
 * just enough ground to stay legible.
 */
export function PaneActions({ note }: { note: NoteSummaryDto }) {
  const t = useT();
  const nt = (key: string, params?: Record<string, string | number>) => t('Notes', key, params);
  const updateNote = useUpdateNoteMetadata();
  const deleteNote = useDeleteNote();
  const openTransfer = useNoteTransfer((state) => state.open);
  const openPdf = useNotePdf((state) => state.open);

  const title = note.title.trim() || nt('Untitled');
  const overCover = coverCss(note.cover) !== null;
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
          className={cn(
            'grid size-7 place-items-center rounded-md text-ink-3 transition-[opacity,color,background-color]',
            'hover:bg-frame-hover hover:text-ink',
            // Reading surface first: revealed on pane hover, on keyboard focus,
            // and while the menu is open, but never left stuck on after a click.
            'opacity-0 group-hover/pane:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100',
            overCover && 'bg-canvas/70 text-ink-2 backdrop-blur-sm',
          )}
        >
          <AppIcon name="common/ellipsis" size={16} />
        </button>
      </MenuTrigger>
      <MenuContent align="end">
        <MenuItem icon={note.isFavorite ? 'common/star-filled' : 'common/star'} onSelect={toggleFavourite}>
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
