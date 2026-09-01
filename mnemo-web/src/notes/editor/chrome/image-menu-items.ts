/**
 * What an image block offers, described once.
 *
 * The pill's kebab and the right-click menu on a picture are the same list, for the same reason
 * the gutter grip and the generic right-click menu are: two Radix families that cannot share
 * components can still share the rows. Right-clicking a picture answers about the picture, so this
 * replaces the generic block menu there rather than sitting beside it.
 *
 * Everything here re-reads the block at run time. A row is built from a snapshot, the dialogs it
 * opens are awaited, and a note can be edited while one is up, so a committed change is always
 * against the block as it is at the commit rather than as it was at the click.
 */

import type { EditorState } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';

import { editImage } from '@/components/ui/image-editor/store';
import { isWholeCrop, type ImageCrop } from '@/components/ui/image-editor/geometry';
import { announceExport, exportSaveOptions, saveExport } from '@/api/export-file';
import type { TranslateFn } from '@/i18n/types';
import { toast } from '@/stores/toast';

import { cropsEqual, readCrop } from '../../model/image-crop';
import { sidsWithin } from '../../selection/block-selection';
import { getBlockSelection } from '../../selection/block-selection-plugin';
import { buildDeleteSelected } from '../../selection/delete-selected';
import { asOwnUndoStep } from '../history';
import {
  clampImageWidth,
  imageAlignOf,
  imagePathOf,
  imageWidthOf,
  IMAGE_SIZE_PRESETS,
  isPresetImageWidth,
  presetImageWidth,
} from '../blocks/image-attrs';
import { bakedImageFileName, bakeImage } from '../blocks/image-bake';
import type { CaptionReveal } from '../blocks/image-caption-reveal';
import { lineText } from '../blocks/shared';
import type { BlockRegistry } from '../registry/build';
import type { EditorServices } from '../registry/types';
import { deleteBlock, locateBlock, type BlockLocation } from './block-commands';
import type { BlockMenuChoice, BlockMenuEntry } from './block-menu-items';

/**
 * The rows a picture offers. Everything the generic menu can be except a request: nothing an image
 * does raises a layer of its own, so the two surfaces that render this need no case for one.
 */
export type ImageMenuEntry = Exclude<BlockMenuEntry, { kind: 'request' }>;

/** The three places a picture can sit, and the lucide glyph that says so. */
const ALIGNMENTS = [
  { id: 'left', key: 'ImageAlignLeftTooltip', icon: 'align-left' },
  { id: 'center', key: 'ImageAlignCenterTooltip', icon: 'align-center' },
  { id: 'right', key: 'ImageAlignRightTooltip', icon: 'align-right' },
] as const;

export interface ImageMenuOptions {
  readonly view: EditorView;
  readonly registry: BlockRegistry;
  /** The image block the rows are about. */
  readonly node: PMNode;
  /** Sibling context for the delete row; the rows re-locate for themselves when they run. */
  readonly location: BlockLocation | null;
  readonly services: EditorServices;
  readonly t: TranslateFn;
  /** The caption switch, absent where no view of this block is up to lend one. */
  readonly caption: CaptionReveal | null;
}

/**
 * One attribute write as one undo step, on a fresh attrs object.
 *
 * ProseMirror attrs are shared between every node that was created from them, so a patch written
 * into the existing object would reach documents this edit has nothing to do with, the undo stack
 * among them.
 */
function commitAttrs(view: EditorView, pos: number, patch: Record<string, unknown>): void {
  const node = view.state.doc.nodeAt(pos);
  if (!node) return;
  view.dispatch(asOwnUndoStep(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...patch })));
}

/** The block again, after an await, or null when it is gone. */
function relocate(view: EditorView, registry: BlockRegistry, loc: BlockLocation): BlockLocation | null {
  return locateBlock(view.state, registry, loc.pos, String(loc.node.attrs.sid ?? ''));
}

/**
 * The width of the row the picture sits in, which is what a size preset is a fraction of.
 *
 * The figure rather than the image: the same element the resize drag measures its ceiling against,
 * so a preset and a drag to the same place agree.
 */
export function imageColumnWidth(view: EditorView, pos: number): number {
  const dom = view.nodeDOM(pos);
  if (!(dom instanceof HTMLElement)) return 0;
  return dom.getBoundingClientRect().width;
}

/** The width the picture is actually drawn at, for a crop that has to keep it. */
function imageFrameWidth(view: EditorView, pos: number): number {
  const dom = view.nodeDOM(pos);
  if (!(dom instanceof HTMLElement)) return 0;
  const frame = dom.querySelector('.notes-image-frame');
  if (!(frame instanceof HTMLElement)) return 0;
  return frame.getBoundingClientRect().width;
}

/** The crop as it is stored: nothing at all when it keeps the whole picture. */
function storedCrop(crop: ImageCrop): ImageCrop | null {
  return isWholeCrop(crop) ? null : crop;
}

/**
 * Applies a new window to the block, and a width along with it when the block has none.
 *
 * A cropped image with no stored width has to be drawn at the full column, because an aspect on
 * its own cannot produce a height and the PDF export makes the same choice. That is right for a
 * note reloaded from disk and wrong as the answer to a crop: the picture would jump to full width
 * the moment its window changed. So the width it is being drawn at right now becomes its width.
 */
function commitCrop(
  view: EditorView,
  pos: number,
  crop: ImageCrop | null,
  extra: Record<string, unknown> = {},
): void {
  const node = view.state.doc.nodeAt(pos);
  if (!node) return;
  const patch: Record<string, unknown> = { ...extra, crop };
  if (crop !== null && imageWidthOf(node) <= 0) {
    const drawn = imageFrameWidth(view, pos);
    if (drawn > 0) patch.width = clampImageWidth(drawn);
  }
  commitAttrs(view, pos, patch);
}

export function imageMenuItems({
  view,
  registry,
  node,
  location,
  services,
  t,
  caption,
}: ImageMenuOptions): readonly ImageMenuEntry[] {
  const ne = (key: string, params?: Record<string, string | number>) => t('NotesEditor', key, params);
  const common = (key: string) => t('Common', key);

  const path = imagePathOf(node);
  const align = imageAlignOf(node);
  const width = imageWidthOf(node);
  const columnWidth = location ? imageColumnWidth(view, location.pos) : 0;

  // Mirrors block-menu-items.ts: a picture that is part of a live multi-block selection has its
  // Delete take the whole selection, not just the block that was right-clicked.
  const selected = getBlockSelection(view.state).selected;
  const leaves = location ? sidsWithin(view.state.doc, registry, location.pos, location.node) : [];
  const inSelection = selected.size > 0 && leaves.some((sid) => selected.has(sid));

  /** Loads the bytes behind the bearer token, as a URL a canvas may read. */
  const bytesOf = async (loc: BlockLocation): Promise<Blob> => {
    const url = await services.loadAssetUrl(imagePathOf(loc.node));
    return await bakeImage(url, readCrop(loc.node.attrs.crop));
  };

  const replace: BlockMenuChoice = {
    kind: 'action',
    id: 'image.replace',
    label: ne('ImageFlyoutReplace'),
    icon: 'image-plus',
    run: async (target, loc) => {
      const picked = await editImage({ title: ne('ImageFlyoutReplace'), confirm: ne('ImageEditorInsert') });
      if (!picked?.file) return;
      let assetId: string;
      try {
        assetId = await services.uploadAsset(picked.file);
      } catch {
        // Nothing was committed, so the block still shows its old picture; the toast is the only
        // sign the replace did not happen.
        toast.warning(ne('ImageImportFailed'));
        return;
      }
      const current = relocate(target, registry, loc);
      if (!current) return;
      // Path and window together: two transactions would leave one frame drawing the new picture
      // through the old picture's window.
      commitCrop(target, current.pos, storedCrop(picked.crop), { path: assetId });
    },
  };

  const reframe: BlockMenuChoice = {
    kind: 'action',
    id: 'image.crop',
    label: ne('ImageCropReposition'),
    icon: 'crop',
    disabled: path.length === 0,
    run: async (target, loc) => {
      const source = imagePathOf(loc.node);
      if (source.length === 0) return;
      // The stored window rather than the drawn one, which is what makes a second pass reframe the
      // original instead of cropping the crop. The aspect is left unlocked so the shape presets
      // are on offer; a figure is not held to any one shape.
      let url: string;
      try {
        url = await services.loadAssetUrl(source);
      } catch {
        toast.warning(ne('ImageEditorLoadFailed'));
        return;
      }
      const picked = await editImage({
        src: url,
        crop: readCrop(loc.node.attrs.crop),
        title: ne('ImageCropReposition'),
        confirm: ne('ImageEditorApply'),
      });
      if (!picked) return;

      const extra: Record<string, unknown> = {};
      // The dialog takes a dropped or pasted file while it is open, so a reframe can come back
      // carrying a different picture.
      if (picked.file) {
        try {
          extra.path = await services.uploadAsset(picked.file);
        } catch {
          // Nothing was committed, so the old window on the old picture still stands.
          toast.warning(ne('ImageImportFailed'));
          return;
        }
      }

      // After every await, not before them: the note can be edited while a dialog is up.
      const current = relocate(target, registry, loc);
      if (!current) return;
      const next = storedCrop(picked.crop);
      // Confirming without moving anything must not dirty the note or spend an undo step.
      if (extra.path === undefined && cropsEqual(readCrop(current.node.attrs.crop), next)) return;
      commitCrop(target, current.pos, next, extra);
    },
  };

  const captionRow: BlockMenuChoice = {
    kind: 'action',
    id: 'image.caption',
    label: ne('ImageFlyoutCaption'),
    icon: 'captions',
    checked: caption?.visible() ?? false,
    disabled: caption === null,
    run: () => {
      caption?.toggle();
    },
  };

  const alignItems: BlockMenuChoice[] = ALIGNMENTS.map((option) => ({
    kind: 'action',
    id: `image.align.${option.id}`,
    label: ne(option.key),
    icon: option.icon,
    checked: align === option.id,
    run: (target, loc) => {
      if (imageAlignOf(loc.node) !== option.id) commitAttrs(target, loc.pos, { align: option.id });
    },
  }));

  const sizeItems: BlockMenuChoice[] = IMAGE_SIZE_PRESETS.map((preset) => ({
    kind: 'action',
    id: `image.size.${preset.id}`,
    label: ne('ImageSizeFormat', { 0: Math.round(preset.fraction * 100) }),
    checked: isPresetImageWidth(width, columnWidth, preset.fraction),
    run: (target, loc) => {
      // Measured again at the click: the pane may have been resized while the menu was open.
      const measured = imageColumnWidth(target, loc.pos);
      if (measured <= 0) return;
      commitAttrs(target, loc.pos, { width: presetImageWidth(measured, preset.fraction) });
    },
  }));

  const copy: BlockMenuChoice = {
    kind: 'action',
    id: 'image.copy',
    label: ne('ImageFlyoutCopyImage'),
    icon: 'copy',
    disabled: path.length === 0,
    run: async (_target, loc) => {
      try {
        const blob = await bytesOf(loc);
        await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      } catch {
        // A successful copy says nothing; the paste is its own receipt. A failure has to, because
        // nothing else would tell you the clipboard is empty.
        toast.warning(ne('ImageCopyFailed'));
      }
    },
  };

  const download: BlockMenuChoice = {
    kind: 'action',
    id: 'image.download',
    label: ne('ImageDownload'),
    icon: 'download',
    disabled: path.length === 0,
    run: async (_target, loc) => {
      try {
        const blob = await bytesOf(loc);
        const outcome = await saveExport(blob, {
          ...exportSaveOptions(common),
          fileName: bakedImageFileName(lineText(loc.node), ne('Image')),
        });
        announceExport(outcome, {
          title: common('ExportCompleteTitle'),
          downloaded: common('TransferExportFinished'),
        });
      } catch (error) {
        toast.warning(common('ExportFailedTitle'), {
          description: error instanceof Error ? error.message : undefined,
        });
      }
    },
  };

  return [
    replace,
    reframe,
    captionRow,
    { kind: 'separator', id: 'image.sep.arrange' },
    { kind: 'submenu', id: 'image.align', label: ne('ImageAlign'), icon: 'align-center', items: alignItems },
    { kind: 'submenu', id: 'image.size', label: ne('ImageSize'), icon: 'notes/width', items: sizeItems },
    { kind: 'separator', id: 'image.sep.out' },
    copy,
    download,
    { kind: 'separator', id: 'image.sep.delete' },
    inSelection
      ? {
          kind: 'verb',
          id: 'delete',
          // The count rides on the label so the row names everything it takes, rather than
          // reading as a single-picture delete next to a selection.
          label: selected.size > 1 ? ne('DeleteBlocksFormat', { 0: selected.size }) : ne('ImageFlyoutDelete'),
          icon: 'common/trash',
          danger: true,
          // The selection announcer speaks the clear that follows, so this stays quiet rather
          // than doubling the live region.
          announce: null,
          build: (state: EditorState) => buildDeleteSelected(state, registry, selected),
        }
      : {
          kind: 'verb',
          id: 'delete',
          label: ne('ImageFlyoutDelete'),
          icon: 'common/trash',
          danger: true,
          // The document may never be emptied, so the last top-level block keeps its row unavailable.
          disabled: (location?.parentPos ?? 0) < 0 && view.state.doc.childCount <= 1,
          announce: ne('BlockDeleted'),
          build: (state: EditorState, loc: BlockLocation) => deleteBlock(state, loc),
        },
  ];
}
