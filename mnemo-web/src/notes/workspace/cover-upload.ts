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

/** Matches the host's limit, so an oversized file is refused before it is sent. */
export const MAX_COVER_BYTES = 20 * 1024 * 1024;

const COVER_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'];

/**
 * The Notes i18n key naming why a file cannot be used as a cover, or null when it can.
 * The host applies the same two rules and a magic-number check on top; this only saves a
 * doomed upload the round trip.
 */
export function coverUploadProblem(file: { name: string; size: number }): string | null {
  if (file.size > MAX_COVER_BYTES) return 'CoverUploadTooLarge';

  const dot = file.name.lastIndexOf('.');
  const extension = dot >= 0 ? file.name.slice(dot).toLowerCase() : '';
  if (!COVER_EXTENSIONS.includes(extension)) return 'CoverUploadUnsupported';

  return null;
}

/** Uploads an image and returns the token to store in the note's cover. */
export async function uploadCover(file: File): Promise<string> {
  const dto = await uploadNoteAsset(file);
  return customCoverReference(dto.assetId);
}
