/**
 * A cropped picture, as pixels.
 *
 * Inside the note a crop is four fractions over an untouched source. The clipboard and the file
 * system have never heard of one, so this is the boundary where it becomes an image: the window is
 * drawn onto a canvas at the size it samples, and what comes out is what the note shows rather
 * than the original somebody cropped away from.
 */

import type { ImageCrop } from '@/components/ui/image-editor/geometry';
import { exportFileName } from '@/api/export-file';
import { KeyedError } from '@/i18n/keyed-error';

/**
 * How far the longest side may run.
 *
 * Past a few thousand pixels a side, canvas allocation starts failing outright on some machines,
 * and a screenshot pasted at full resolution reaches that on its own.
 */
export const MAX_BAKED_EDGE = 2048;

function load(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      resolve(image);
    };
    image.onerror = () => {
      reject(new KeyedError('NotesEditor', 'ImageBakeDecodeFailed'));
    };
    image.src = url;
  });
}

/**
 * The window of `url` named by `crop`, as a PNG blob. A null crop bakes the whole picture.
 *
 * `url` has to be same origin (the asset service hands out blob URLs), or the canvas is tainted
 * and `toBlob` throws rather than returning bytes.
 */
export async function bakeImage(url: string, crop: ImageCrop | null): Promise<Blob> {
  const image = await load(url);
  const naturalWidth = image.naturalWidth || image.width;
  const naturalHeight = image.naturalHeight || image.height;
  if (naturalWidth <= 0 || naturalHeight <= 0) throw new KeyedError('NotesEditor', 'ImageBakeNoSize');

  const sx = crop ? crop.x * naturalWidth : 0;
  const sy = crop ? crop.y * naturalHeight : 0;
  const sw = crop ? crop.w * naturalWidth : naturalWidth;
  const sh = crop ? crop.h * naturalHeight : naturalHeight;

  const scale = Math.min(1, MAX_BAKED_EDGE / Math.max(sw, sh));
  const width = Math.max(1, Math.round(sw * scale));
  const height = Math.max(1, Math.round(sh * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new KeyedError('NotesEditor', 'ImageBakeNoCanvas');
  try {
    context.drawImage(image, sx, sy, sw, sh, 0, 0, width, height);
  } catch {
    throw new KeyedError('NotesEditor', 'ImageBakePngFailed');
  }

  return await new Promise<Blob>((resolve, reject) => {
    try {
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new KeyedError('NotesEditor', 'ImageBakePngFailed'));
        },
        'image/png',
      );
    } catch {
      reject(new KeyedError('NotesEditor', 'ImageBakePngFailed'));
    }
  });
}

/**
 * A file name a person recognizes: the caption, reduced to what a file system will take.
 *
 * Built on exportFileName's own sanitizing, with the one thing a caption needs beyond it: the
 * whitespace collapse, and a length cap so a paragraph-long caption still fits a file system's
 * name limit. The cap runs on the stem, before .png is appended, and is followed by a second
 * strip of a trailing dot, because the cap can cut mid-string and land on one that
 * exportFileName's own strip (which only reaches the ends of the untruncated caption) never saw.
 * Skipping that second strip is what used to produce a bare dot before the extension.
 */
export function bakedImageFileName(caption: string, fallback: string): string {
  const collapsed = caption.replace(/\s+/g, ' ').trim();
  const stem = exportFileName(collapsed, fallback, '')
    .slice(0, 60)
    .replace(/\.+$/, '');
  return `${stem || fallback}.png`;
}
