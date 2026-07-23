/**
 * Writes a copied slice to the OS clipboard in three fidelity tiers.
 *
 * ProseMirror serializes the slice to HTML the same way it would for its own
 * copy, and the nonce that keys the in-memory buffer is stamped onto that HTML.
 * A same-app paste matches the nonce and restores the exact slice; an external
 * app reads the HTML for rich text or the plain-text markdown, the ceiling for
 * pasting into Docs, Word or a plain editor.
 *
 * The exact payload rides two carriers on purpose. The synchronous copy event
 * (unlike the async clipboard API, which sanitizes to standard types) accepts an
 * arbitrary private MIME, so the same HTML is set under `text/_mnemo-blocks-v1`
 * as well; and because a WebKitGTK clipboard can drop an unknown type, the nonce
 * and payload also live inside the `text/html` a paste can always read. Neither
 * is required for correctness, together they make same-app paste survive engine
 * differences.
 */

import type { Slice } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';

/** Private clipboard type carrying the exact serialized slice for a same-app paste. */
export const MNEMO_CLIPBOARD_MIME = 'text/_mnemo-blocks-v1';
/** Attribute on the clipboard HTML naming the in-memory buffer entry to restore. */
export const MNEMO_NONCE_ATTR = 'data-mnemo-nonce';

export function writeSliceToClipboard(
  view: EditorView,
  data: DataTransfer,
  slice: Slice,
  nonce: string,
  plainText: string,
): void {
  const serialized = view.serializeForClipboard(slice);
  serialized.dom.setAttribute(MNEMO_NONCE_ATTR, nonce);
  const html = serialized.dom.outerHTML;

  data.setData('text/html', html);
  data.setData('text/plain', plainText);
  try {
    data.setData(MNEMO_CLIPBOARD_MIME, html);
  } catch {
    // An engine that refuses a non-standard clipboard type still has the nonce
    // and payload in text/html, so the paste path recovers without it.
  }
}
