/**
 * The same-app read path: recover the exact copied slice from the clipboard.
 *
 * A copy stamps a nonce onto the clipboard HTML (and the private MIME carrying
 * the same HTML) and stashes the live slice under that nonce. A paste reads the
 * nonce back and returns the stashed slice, which is lossless for every block,
 * mark, atom and column shape the reparsed HTML would only approximate.
 *
 * The private MIME is read first and text/html second: both hold the same
 * payload, but an engine that dropped the non-standard type on the way through
 * the OS clipboard still left the nonce inside the HTML. A clipboard that is not
 * ours (no nonce) returns null and the paste falls through to the editor's own
 * handling. A clipboard that carries our nonce but whose stashed slice is gone,
 * a copy from a previous run of the app, also returns null here; reconstructing
 * that slice from the HTML is the external-parse path's job, not this one.
 */

import type { Slice } from 'prosemirror-model';

import { readStashedSlice, type ClipboardMode } from './internal-buffer';
import { MNEMO_CLIPBOARD_MIME, MNEMO_NONCE_ATTR } from './write-clipboard';

export interface InternalPaste {
  readonly slice: Slice;
  readonly mode: ClipboardMode;
}

const nonceInHtml = new RegExp(`${MNEMO_NONCE_ATTR}="([^"]+)"`);

/** The stashed slice for the clipboard's nonce, or null when it is not ours. */
export function readInternalSlice(data: DataTransfer): InternalPaste | null {
  const html = data.getData(MNEMO_CLIPBOARD_MIME) || data.getData('text/html');
  if (!html) return null;

  const match = nonceInHtml.exec(html);
  if (!match) return null;

  return readStashedSlice(match[1]);
}
