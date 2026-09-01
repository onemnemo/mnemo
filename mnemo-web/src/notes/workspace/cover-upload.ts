/**
 * A cover the user brought, stored in the same opaque token as a preset. The prefix is
 * the whole grammar: `asset:{assetId}` names a file in the note-assets store, anything
 * else names a preset or nothing. A reader that has not learned the prefix resolves no
 * gradient for it and draws no cover, rather than a broken banner.
 *
 * Any token shape added here that names a file must also be collected by the host's
 * asset sweep (Mnemo.Host/Notes/NoteAssetReferenceSource.cs), or the file is an orphan
 * and gets deleted out from under the note.
 */

import { MIN_FRACTION, type ImageCrop } from '@/components/ui/image-editor/geometry';

import { noteAssetRequestPath, uploadNoteAsset } from '../assets/api';

const CUSTOM_COVER_PREFIX = 'asset:';

/** The token stored for an uploaded cover. */
export function customCoverReference(assetId: string): string {
  return `${CUSTOM_COVER_PREFIX}${assetId}`;
}

export function isCustomCover(token: string | null | undefined): token is string {
  return typeof token === 'string' && token.startsWith(CUSTOM_COVER_PREFIX);
}

/**
 * The API request path serving an uploaded cover's bytes, or null for any other token.
 * The prefix comes off before the note asset resolver sees the id: that resolver rejects
 * anything carrying a colon, so a whole token handed to it would always resolve to
 * nothing. Ids with a separator are refused here as well as on the host, so a malformed
 * value can never be pasted into a request path.
 */
export function customCoverRequestPath(token: string | null | undefined): string | null {
  if (!isCustomCover(token)) return null;

  const assetId = token.slice(CUSTOM_COVER_PREFIX.length);
  if (assetId.length === 0 || assetId.includes('/') || assetId.includes('\\') || assetId.includes('..'))
    return null;

  return noteAssetRequestPath(assetId);
}

/** Uploads an image and returns the token to store in the note's cover. */
export async function uploadCover(file: File): Promise<string> {
  const dto = await uploadNoteAsset(file);
  return customCoverReference(dto.assetId);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * The stored cover crop, or null for anything that cannot be drawn: missing, malformed, a
 * degenerate or out-of-range window, or a non-positive aspect. A reader that cannot make sense
 * of the field falls back to the plain uncropped banner rather than stretching or throwing.
 *
 * The window's own floor mirrors the geometry module's `MIN_FRACTION`, so a crop this rejects is
 * exactly one `fitCropToContainer` would also have had to clamp away from zero.
 */
export function parseCoverCrop(raw: string | null): ImageCrop | null {
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;

  const { x, y, w, h, aspect } = parsed as Record<string, unknown>;
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(w) || !isFiniteNumber(h) || !isFiniteNumber(aspect))
    return null;
  if (aspect < MIN_FRACTION) return null;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  if (w < MIN_FRACTION || w > 1 || h < MIN_FRACTION || h > 1) return null;
  // A window is a size over an origin; either edge landing past the source's own boundary is out
  // of range in the same way a negative origin already is.
  if (x + w > 1 || y + h > 1) return null;

  return { x, y, w, h, aspect };
}

/** The crop, as the opaque string the note field stores. */
export function serializeCoverCrop(crop: ImageCrop): string {
  return JSON.stringify(crop);
}
