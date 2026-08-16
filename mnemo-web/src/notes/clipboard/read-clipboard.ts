/**
 * The same-app read path: recover the exact copied slice from the clipboard.
 *
 * A copy carries a nonce and the exact slice-as-JSON. A paste reads them back and
 * restores the slice, lossless for every block, mark, atom and column shape. The
 * private MIME (exact JSON) is read first; text/html is the fallback, holding at
 * least the nonce so a same-session paste still finds its in-memory buffer on an
 * engine that dropped the private type.
 *
 * A clipboard that is not ours (no nonce anywhere) returns null and the paste
 * falls through to the editor's own handling.
 */

import type { Slice } from 'prosemirror-model';

import { readStashedSlice, type ClipboardMode } from './internal-buffer';
import { MNEMO_CLIPBOARD_MIME, MNEMO_MODE_ATTR, MNEMO_NONCE_ATTR, type ClipPayload } from './write-clipboard';

export interface InternalPaste {
  readonly slice: Slice;
  readonly mode: ClipboardMode;
}

/** What a Mnemo copy left on the clipboard: the nonce, the mode, and the exact payload if present. */
export interface ClipMeta {
  readonly nonce: string;
  readonly mode: ClipboardMode;
  /** The exact slice-as-JSON, present unless the private type was dropped. */
  readonly payload: ClipPayload | null;
}

const nonceInHtml = new RegExp(`${MNEMO_NONCE_ATTR}="([^"]+)"`);
const modeInHtml = new RegExp(`${MNEMO_MODE_ATTR}="([^"]+)"`);

/**
 * A ceiling on the private payload before it is even parsed. The payload is
 * attacker-reachable (a hostile page can set an arbitrary sync-copy MIME), so an
 * unbounded string here would be a JSON.parse-then-build-tree denial of service.
 * Our own copies are far smaller; a genuinely huge same-session copy pastes from
 * the buffer, not this path.
 */
const MAX_PAYLOAD_LENGTH = 4_000_000;

/** The Mnemo metadata on the clipboard, or null when the clipboard is not ours. */
export function readClipMeta(data: DataTransfer): ClipMeta | null {
  const payload = parsePayload(data.getData(MNEMO_CLIPBOARD_MIME));
  if (payload) return { nonce: payload.nonce, mode: payload.mode, payload };

  // The private type was dropped: recover the nonce (and mode) from the HTML.
  const html = data.getData('text/html');
  if (!html) return null;
  const nonce = nonceInHtml.exec(html)?.[1];
  if (!nonce) return null;
  const mode: ClipboardMode = modeInHtml.exec(html)?.[1] === 'text' ? 'text' : 'blocks';
  return { nonce, mode, payload: null };
}

/** The stashed slice for the clipboard's nonce, or null when it is not ours or is gone. */
export function readInternalSlice(data: DataTransfer): InternalPaste | null {
  const meta = readClipMeta(data);
  if (!meta) return null;

  return readStashedSlice(meta.nonce);
}

function parsePayload(raw: string): ClipPayload | null {
  if (!raw || raw.length > MAX_PAYLOAD_LENGTH) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' && parsed !== null &&
      (parsed as ClipPayload).v === 1 &&
      typeof (parsed as ClipPayload).nonce === 'string' &&
      (parsed as ClipPayload).slice != null
    ) {
      return parsed as ClipPayload;
    }
  } catch {
    // Not our JSON (or truncated): fall back to the HTML nonce.
  }
  return null;
}
