/**
 * Reading an image block's attrs, and the widths one is allowed to be.
 *
 * Here rather than in each surface because the renderer, the pill and both menus ask the same
 * questions of the same block, and an alignment read two ways eventually disagrees with itself.
 *
 * Stored widths are pixels, so a size preset is a measurement rather than a constant: a quarter of
 * the column is a different number of pixels in a full-width note than in a narrow pane, and the
 * fraction has to be resolved against the column the block is sitting in right now.
 */

import type { Node as PMNode } from 'prosemirror-model';

export function imagePathOf(node: PMNode): string {
  return String(node.attrs.path ?? '');
}

/** Anything the document does not name reads as left, which is what the schema defaults to. */
export function imageAlignOf(node: PMNode): string {
  const align = String(node.attrs.align ?? 'left');
  return align === 'center' || align === 'right' ? align : 'left';
}

/** Zero for a block that was never resized, which draws at its own size or at the column. */
export function imageWidthOf(node: PMNode): number {
  return Number(node.attrs.width) || 0;
}

/** The desktop's resize clamp: never below a usable hit target, never past its hard cap. */
export const MIN_IMAGE_WIDTH = 80;
export const MAX_IMAGE_WIDTH = 1600;

/** How far a stored width may sit from a preset and still read as that preset. */
const PRESET_TOLERANCE = 0.02;

export interface ImageSizePreset {
  readonly id: string;
  readonly fraction: number;
}

export const IMAGE_SIZE_PRESETS: readonly ImageSizePreset[] = [
  { id: 'quarter', fraction: 0.25 },
  { id: 'half', fraction: 0.5 },
  { id: 'three-quarters', fraction: 0.75 },
  { id: 'full', fraction: 1 },
];

export function clampImageWidth(width: number): number {
  return Math.round(Math.min(MAX_IMAGE_WIDTH, Math.max(MIN_IMAGE_WIDTH, width)));
}

/** A preset as the pixel width it commits to, against the column measured at the click. */
export function presetImageWidth(columnWidth: number, fraction: number): number {
  return clampImageWidth(columnWidth * fraction);
}

/**
 * Whether the block already sits at a preset.
 *
 * Against the preset's own committed pixels rather than the raw fraction, because the two part
 * ways under the clamp: in a column narrower than MIN_IMAGE_WIDTH / fraction (320px for a
 * quarter), the preset commits the 80px floor, and no stored width would ever read as that
 * fraction of the column again. Re-deriving the committed value keeps the tick reachable there.
 */
export function isPresetImageWidth(width: number, columnWidth: number, fraction: number): boolean {
  if (width <= 0 || columnWidth <= 0) return false;
  const committed = presetImageWidth(columnWidth, fraction);
  return Math.abs(width - committed) <= committed * PRESET_TOLERANCE;
}
