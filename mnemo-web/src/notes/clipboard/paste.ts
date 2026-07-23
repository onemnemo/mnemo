/**
 * Paste, across every source a clipboard can carry.
 *
 * The ladder, in order of fidelity:
 *
 *  1. Our own copy, still in the session buffer: the exact slice, restored
 *     losslessly and placed by the mode it was copied in (whole blocks split in
 *     as siblings, a text range merges inline).
 *  2. Our own copy whose buffer is gone (a copy from a previous run): the exact
 *     slice rebuilt from the JSON payload, then placed the same way.
 *  3. HTML from another app: sanitised, parsed with our schema, and dropped in
 *     with ProseMirror's own fitting, the way any browser paste behaves. An
 *     over-large paste degrades to plain text rather than being parsed.
 *  4. Nothing we handle: return false and let the editor's default take the
 *     plain text.
 *
 * Every pasted block has its identity cleared so the pipeline mints fresh sids,
 * unsafe link marks are stripped, and every insertion is one undo step.
 *
 * The whole thing is hardened against a hostile clipboard: the private payload
 * and every MIME are attacker-reachable, so each insertion is wrapped and can
 * only fail closed. This is not defensive habit, it is load-bearing: ProseMirror
 * calls `preventDefault` only after `handlePaste` returns, so a throw here would
 * let the browser fall back to natively pasting the unsanitised HTML, firing
 * remote loads and skipping the sanitiser entirely. So a malformed or over-deep
 * payload degrades to the sanitised HTML or plain-text path; it never throws.
 */

import { Slice } from 'prosemirror-model';
import type { Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

import type { BlockRegistry } from '../editor/registry/build';
import { asOwnUndoStep } from '../editor/history';
import type { ClipboardMode } from './internal-buffer';
import { readStashedSlice } from './internal-buffer';
import { withFreshIdentity } from './clear-identity';
import { dropUnsafeLinks } from './scrub-marks';
import { parseExternalHtml } from './parse-html';
import { placeBlockRun } from './place-blocks';
import { readClipMeta } from './read-clipboard';

/** A ceiling on the plain-text degrade path, so an over-large paste stays bounded there too. */
const MAX_PLAIN_TEXT_LENGTH = 2_000_000;

export function handleInternalPaste(
  view: EditorView,
  data: DataTransfer | null,
  registry: BlockRegistry,
): boolean {
  if (!data) return false;
  const { schema } = view.state;

  const meta = readClipMeta(data);
  if (meta) {
    const buffered = readStashedSlice(meta.nonce);
    if (buffered && placeInternal(view, registry, buffered.slice, buffered.mode)) return true;
    if (!buffered && meta.payload && placeFromJson(view, registry, meta.payload.slice, meta.mode)) {
      return true;
    }
    // Our clip, but placement failed or there was nothing to place: fall through
    // to the HTML / plain-text path rather than crash or reparse.
  }

  const html = data.getData('text/html');
  if (html.trim() !== '') {
    let placed = false;
    try {
      const parsed = parseExternalHtml(html, schema);
      placed = parsed !== 'too-large' && parsed !== null && placeExternal(view, parsed.slice);
    } catch {
      // Even the parser is fed attacker input; a throw here must not escape, or
      // the browser would native-paste the raw HTML.
      placed = false;
    }
    if (placed) return true;
    return pastePlainText(view, data);
  }

  return false;
}

/** Reconstruct an attacker-reachable JSON payload, never letting a bad one throw out. */
function placeFromJson(
  view: EditorView,
  registry: BlockRegistry,
  sliceJson: unknown,
  mode: ClipboardMode,
): boolean {
  let slice: Slice;
  try {
    slice = Slice.fromJSON(view.state.schema, sliceJson);
  } catch {
    return false;
  }
  return placeInternal(view, registry, slice, mode);
}

/** Place an internal slice: fresh identity, unsafe links dropped, split-in or inline-merge. */
function placeInternal(
  view: EditorView,
  registry: BlockRegistry,
  slice: Slice,
  mode: ClipboardMode,
): boolean {
  try {
    const prepared = dropUnsafeLinks(withFreshIdentity(slice, registry));
    const tr = mode === 'blocks' ? placeBlockRun(view.state, prepared) : view.state.tr.replaceSelection(prepared);
    return dispatchPaste(view, tr);
  } catch {
    // A structurally invalid payload can throw only when placed, not when
    // deserialized; fail closed so the caller degrades instead of the tab.
    return false;
  }
}

function placeExternal(view: EditorView, slice: Slice): boolean {
  try {
    return dispatchPaste(view, view.state.tr.replaceSelection(slice));
  } catch {
    return false;
  }
}

/** Insert the clipboard's plain text, capped, and claim the event either way. */
function pastePlainText(view: EditorView, data: DataTransfer): boolean {
  const text = data.getData('text/plain').slice(0, MAX_PLAIN_TEXT_LENGTH);
  if (text !== '') {
    try {
      dispatchPaste(view, view.state.tr.insertText(text));
    } catch {
      // Nothing safe to insert; still claim the event below.
    }
  }
  // Claim it regardless: we chose to handle this paste, and letting it fall
  // through would reparse the unsanitised HTML we just declined.
  return true;
}

function dispatchPaste(view: EditorView, tr: Transaction): boolean {
  if (!tr.docChanged) return false;
  view.dispatch(asOwnUndoStep(tr).scrollIntoView());
  return true;
}
