import { useEffect, useState } from 'react';

import { navigate } from '@/app/router';
import { EmojiPickerPopover } from '@/components/emoji/EmojiPickerPopover';
import { AppIcon } from '@/components/icon/AppIcon';
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSubMenu,
  MenuTrigger,
} from '@/components/ui/menu';
import { useT } from '@/i18n/useT';
import { cn } from '@/lib/utils';
import { dialog } from '@/stores/dialog';
import { useSettingsStore } from '@/settings/store';
import type { NoteSummaryDto } from '@/api/types';

import { useDeleteNote, useDuplicateNote, useUpdateNoteMetadata } from '../api';
import { metadataUpdateOf } from '../note-metadata';
import { useNotePdf } from '../pdf/store';
import { useNoteTransfer } from '../transfer/store';
import { hasCover } from './covers';
import { CoverPicker } from './NoteHeaderChrome';
import { EDITOR_WIDTH_KEY, useEditorMeasure, useEditorWidthOptions } from './useEditorMeasure';

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
  const duplicateNote = useDuplicateNote();
  const openTransfer = useNoteTransfer((state) => state.open);
  const openPdf = useNotePdf((state) => state.open);

  const setSetting = useSettingsStore((state) => state.setValue);
  const widthOptions = useEditorWidthOptions();
  const { value: width } = useEditorMeasure();

  // Which picker the menu raised, if any, and which one it is about to.
  //
  // Radix tears its menu layer down and returns focus as the menu closes, and a
  // popover opened during that teardown is dismissed along with it. So a menu
  // item only records the intent, and the picker opens on the frame after the
  // menu has actually gone, leaving one layer on screen at a time.
  // The intent is state, not a ref: an effect that consumed a ref would be spent
  // by the first of StrictMode's two passes and the picker would never open.
  const [menuOpen, setMenuOpen] = useState(false);
  const [picker, setPicker] = useState<'icon' | 'cover' | null>(null);
  const [pending, setPending] = useState<'icon' | 'cover' | null>(null);

  // A timer rather than an animation frame: frames are throttled or suspended
  // entirely while the window is not compositing, and a control that needs the
  // window painting to open at all is a control that sometimes does not open.
  useEffect(() => {
    if (menuOpen || !pending) return;
    const timer = setTimeout(() => {
      setPicker(pending);
      setPending(null);
    }, 0);
    return () => clearTimeout(timer);
  }, [menuOpen, pending]);

  const title = note.title.trim() || nt('Untitled');
  const overCover = hasCover(note.cover);
  const toggleFavourite = () => void updateNote.mutateAsync(metadataUpdateOf(note, { isFavorite: !note.isFavorite }));
  const patch = (next: Partial<Pick<NoteSummaryDto, 'emoji' | 'cover'>>) =>
    void updateNote.mutateAsync(metadataUpdateOf(note, next));

  const rename = async () => {
    const next = await dialog.prompt({
      title: nt('Rename'),
      defaultValue: note.title,
      confirmLabel: t('Common', 'Save'),
      cancelLabel: t('Common', 'Cancel'),
    });
    if (next === null) return;
    const trimmed = next.trim();
    if (!trimmed || trimmed === note.title.trim()) return;
    await updateNote.mutateAsync(metadataUpdateOf(note, { title: trimmed }));
  };

  const duplicate = async () => {
    const copy = await duplicateNote.mutateAsync({ id: note.id, title: nt('CopyOfFormat', { 0: title }) });
    if (copy && typeof copy === 'object' && 'id' in copy) navigate('notes', String(copy.id));
  };

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
    <div className="relative">
      <Menu open={menuOpen} onOpenChange={setMenuOpen}>
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
          <MenuItem icon="flyout/rename" onSelect={() => void rename()}>
            {nt('Rename')}
          </MenuItem>
          <MenuItem icon="notes/emoji" onSelect={() => setPending('icon')}>
            {note.emoji ? nt('ChangeIcon') : nt('AddIcon')}
          </MenuItem>
          <MenuItem icon="common/image" onSelect={() => setPending('cover')}>
            {overCover ? nt('ChangeCover') : nt('AddCover')}
          </MenuItem>
          <MenuItem icon="common/copy" onSelect={() => void duplicate()}>
            {nt('Duplicate')}
          </MenuItem>
          <MenuSeparator />
          {/* The same Editor Width the settings page writes, reachable from the
              document it changes: it is a per-read preference, not a setup step. */}
          <MenuSubMenu label={t('Settings', 'EditorWidth')} icon="notes/width">
            <MenuRadioGroup value={width} onValueChange={(next) => void setSetting(EDITOR_WIDTH_KEY, next)}>
              {widthOptions.map((option) => (
                <MenuRadioItem key={option.value} value={option.value}>
                  {option.value}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuSubMenu>
          <MenuSeparator />
          <MenuItem
            icon="common/upload"
            onSelect={() => openTransfer({ direction: 'export', scope: { label: title, noteIds: [note.id] } })}
          >
            {nt('Export')}
          </MenuItem>
          {/* Its own row rather than a format inside the export dialog: a PDF is a layout
              decision, and the dialog behind this one is a page-setup panel with a preview,
              not the three-field form the other formats share. A printer, not a download
              arrow, for the same reason. */}
          <MenuItem icon="printer" onSelect={() => openPdf({ noteId: note.id, title })}>
            {nt('ToolbarExportPdf')}
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon="common/trash" danger onSelect={() => void remove()}>
            {nt('DeleteNote')}
          </MenuItem>
        </MenuContent>
      </Menu>

      {/* Anchored to the same corner the menu came from, with a zero-size trigger:
          the pickers belong to the menu items, not to a control of their own. */}
      <EmojiPickerPopover
        value={note.emoji}
        label={nt('AddIcon')}
        onChange={(emoji) => patch({ emoji })}
        open={picker === 'icon'}
        onOpenChange={(open) => setPicker(open ? 'icon' : null)}
      >
        <span aria-hidden className="block size-0" />
      </EmojiPickerPopover>
      <CoverPicker
        token={note.cover}
        onChange={(cover) => patch({ cover })}
        open={picker === 'cover'}
        onOpenChange={(open) => setPicker(open ? 'cover' : null)}
      >
        <span aria-hidden className="block size-0" />
      </CoverPicker>
    </div>
  );
}
