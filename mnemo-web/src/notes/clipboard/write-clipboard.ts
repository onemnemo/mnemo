/**
 * Writes a copied slice to the OS clipboard in three fidelity tiers.
 *
 * The exact payload is the slice serialized to JSON, carried in the private
 * `text/_mnemo-blocks-v1` type. A same-app paste restores it losslessly through
 * `Slice.fromJSON`, which is why the exact path is JSON and not the rendered
 * HTML: the schema renders a block's line as a `<div>` inside a `<p>`, and that
 * nesting does not survive an HTML reparse (the parser closes the `<p>`), so the
 * HTML is faithful going out to another app but not coming back to us.
 *
 * The other two tiers are for everyone else. `text/html` is ProseMirror's rich
 * rendering, the ceiling for pasting into Docs or Word, and it also carries the
 * nonce and mode so a same-session paste still finds its in-memory buffer even on
 * an engine that drops the private type. `text/plain` is the Mnemo markdown.
 *
 * The synchronous copy event accepts an arbitrary private MIME (unlike the async
 * clipboard API, which sanitises to standard types), so the exact JSON rides
 * `text/_mnemo-blocks-v1` directly; a `try` guards the one engine that still
 * refuses it, and the nonce in the HTML is enough to recover the buffer without.
 */

import type { Slice } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';

import type { ClipboardMode } from './internal-buffer';

/** Private clipboard type carrying the exact slice as JSON for a same-app paste. */
export const MNEMO_CLIPBOARD_MIME = 'text/_mnemo-blocks-v1';
/** Attribute on the clipboard HTML naming the in-memory buffer entry to restore. */
export const MNEMO_NONCE_ATTR = 'data-mnemo-nonce';
/** Attribute recording whether the copy was whole blocks or a text range, for placement. */
export const MNEMO_MODE_ATTR = 'data-mnemo-mode';

/** The exact payload: a nonce keying the buffer, the copy mode, and the slice as JSON. */
export interface ClipPayload {
  readonly v: 1;
  readonly nonce: string;
  readonly mode: ClipboardMode;
  readonly slice: unknown;
}

export function writeSliceToClipboard(
  view: EditorView,
  data: DataTransfer,
  slice: Slice,
  nonce: string,
  plainText: string,
  mode: ClipboardMode,
): void {
  const payload: ClipPayload = { v: 1, nonce, mode, slice: slice.toJSON() };

  const serialized = view.serializeForClipboard(slice);
  serialized.dom.setAttribute(MNEMO_NONCE_ATTR, nonce);
  serialized.dom.setAttribute(MNEMO_MODE_ATTR, mode);
  const html = serialized.dom.outerHTML;

  data.setData('text/html', html);
  data.setData('text/plain', plainText);
  try {
    data.setData(MNEMO_CLIPBOARD_MIME, JSON.stringify(payload));
  } catch {
    // An engine that refuses a non-standard clipboard type still has the nonce in
    // text/html, so a same-session paste recovers the exact slice from the buffer.
  }
}
