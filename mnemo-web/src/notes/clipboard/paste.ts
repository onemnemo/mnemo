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
 *  4. Plain text: read as Mnemo markdown, the desktop's only paste dialect, so a
 *     pasted markdown document becomes real blocks. One line folds inline at the
 *     caret; a run of blocks is placed like an Enter split. Only genuinely empty
 *     text is left to the editor's default.
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

import { Fragment, Slice } from 'prosemirror-model';
import type { EditorState, Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

import type { BlockRegistry } from '../editor/registry/build';
import { asOwnUndoStep } from '../editor/history';
import { createDocumentMapper } from '../editor/mapper/document';
import { lineOf } from '../editor/blocks/shared';
import type { ClipboardMode } from './internal-buffer';
import { readStashedSlice } from './internal-buffer';
import { withFreshIdentity } from './clear-identity';
import { dropUnsafeLinks } from './scrub-marks';
import { parseMarkdownToBlocks } from './markdown-blocks';
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
    return pastePlainText(view, data, registry);
  }

  // No HTML at all: plain text, read as the desktop's markdown paste dialect.
  // Empty or whitespace-only text is nothing block-structured to handle, so it
  // is left to the editor's own default rather than claimed and dropped.
  if (data.getData('text/plain').trim() === '') return false;
  return pastePlainText(view, data, registry);
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

/**
 * Read the clipboard's plain text as Mnemo markdown, capped, and always claim it.
 *
 * A single line of ordinary text folds inline at the caret, the everyday "paste
 * a word" case; a run of blocks is placed like an Enter split; and a paste
 * inside a code or sketch line stays literal, since markdown structure is
 * content there, not syntax. Every branch is wrapped: a throw here would let the
 * browser native-paste whatever raw HTML we just declined, so a bad parse or an
 * unplaceable slice degrades to a literal insert instead.
 */
function pastePlainText(view: EditorView, data: DataTransfer, registry: BlockRegistry): boolean {
  const text = data.getData('text/plain').slice(0, MAX_PLAIN_TEXT_LENGTH);
  if (text === '') return true;

  try {
    // Source content is literal: re-parsing a fence pasted into code would eat it.
    if (inSourceLine(view.state)) {
      dispatchPaste(view, view.state.tr.insertText(text));
      return true;
    }

    const blocks = parseMarkdownToBlocks(text);
    if (blocks.length === 0) return true;

    const mapper = createDocumentMapper(view.state.schema, registry);

    // One line of ordinary text merges into the current line rather than
    // splitting a new block off, the way the desktop merges a single Text block.
    if (blocks.length === 1 && blocks[0].type === 'Text') {
      const line = lineOf(mapper.toNode(blocks[0]));
      const inline = dropUnsafeLinks(new Slice(line ? line.content : Fragment.empty, 0, 0));
      dispatchPaste(view, view.state.tr.replaceSelection(inline));
      return true;
    }

    const nodes = blocks.map((block) => mapper.toNode(block));
    const run = dropUnsafeLinks(new Slice(Fragment.fromArray(nodes), 0, 0));
    dispatchPaste(view, placeBlockRun(view.state, run));
    return true;
  } catch {
    // A hostile or malformed paste threw while parsing or placing: fall back to a
    // literal insert so the event is still handled and never native-pasted.
    try {
      dispatchPaste(view, view.state.tr.insertText(text));
    } catch {
      // Nothing safe to insert; still claim the event below.
    }
    return true;
  }
}

/** True when the caret sits in a code or sketch line, where content is literal. */
function inSourceLine(state: EditorState): boolean {
  return state.selection.$from.parent.type.name === 'codeLine';
}

function dispatchPaste(view: EditorView, tr: Transaction): boolean {
  if (!tr.docChanged) return false;
  view.dispatch(asOwnUndoStep(tr).scrollIntoView());
  return true;
}
