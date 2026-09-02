/**
 * Keeps the caret out of the lines that cannot hold one.
 *
 * Two families of block carry the mandatory structural line every block has and
 * put nothing in it for the user. A container (a two-column, its cells, a table,
 * a row) keeps its content a level down and the CSS hides the line. A block that
 * draws itself entirely from its payload (a divider, an equation, a page card)
 * renders no editable content for its line at all, and its serializer writes no
 * spans, so anything typed there is on screen until the note is reopened and
 * gone afterwards. Either way the position exists in the document while nothing
 * in the DOM sits at it, arrow keys walk into it from both sides, and a
 * structural command run there treats the wrapper as the caret's block. This
 * guard relocates such a selection to the nearest real line, in the direction
 * the selection was moving, so an arrow key appears to step straight across it.
 *
 * Both ends are inspected, not just the head. A forward selection anchored in
 * one of these lines keeps `$from` there however far its head travels, and
 * `$from` is what a structural command resolves the caret's block from.
 */

import type { ResolvedPos } from 'prosemirror-model';
import { Plugin, PluginKey, Selection, TextSelection, type EditorState } from 'prosemirror-state';
import { lineIsCaretTarget } from '../blocks/shared';

/** True when the position sits in a line whose owner holds no caret. */
export function inCaretlessLine($pos: ResolvedPos): boolean {
  if ($pos.depth < 1 || !$pos.parent.isTextblock) return false;
  const owner = $pos.node($pos.depth - 1);
  // The line is always the owner's first child.
  return !lineIsCaretTarget(owner.type) && $pos.index($pos.depth - 1) === 0;
}

/**
 * The nearest selection outside any caret-less line, searching from `$from` in
 * `bias` direction first and flipping if that side of the document runs out.
 * Null when no real line exists anywhere, which a non-empty document cannot
 * produce.
 */
function escapeCaretlessLine(
  state: EditorState,
  $from: ResolvedPos,
  bias: 1 | -1,
): Selection | null {
  let $pos = $from;
  let dir = bias;
  // Each step leaves the current line entirely, so the walk is bounded by the
  // block count; the cap only protects against a shape this file cannot foresee.
  for (let guard = 0; guard < 64; guard++) {
    const boundary = dir > 0 ? $pos.after($pos.depth) : $pos.before($pos.depth);
    const found = Selection.findFrom(state.doc.resolve(boundary), dir, true);
    if (!found) {
      // That side of the document is exhausted (a split at the very edge):
      // turn around and keep walking.
      dir = dir > 0 ? -1 : 1;
      continue;
    }
    if (!inCaretlessLine(found.$head)) return found;
    $pos = found.$head;
  }
  return null;
}

const guardKey = new PluginKey('notes-container-caret');

export function containerCaretGuard(): Plugin {
  return new Plugin({
    key: guardKey,
    appendTransaction(_transactions, oldState, newState) {
      const sel = newState.selection;
      const headStuck = inCaretlessLine(sel.$head);
      const anchorStuck = inCaretlessLine(sel.$anchor);
      if (!headStuck && !anchorStuck) return null;

      // The direction the selection travelled decides which real line reads as
      // "the next one over"; a fresh click has no travel and falls forward.
      const headBias: 1 | -1 = sel.head >= oldState.selection.head ? 1 : -1;
      const head = headStuck ? escapeCaretlessLine(newState, sel.$head, headBias) : null;
      if (headStuck && !head) return null;
      if (sel.empty) return head ? newState.tr.setSelection(head) : null;

      // The anchor is the end the user is not moving, so it escapes towards the
      // head rather than away from it: the range then covers the content between
      // the two ends instead of growing past the block the anchor was stuck in.
      const anchorBias: 1 | -1 = sel.head >= sel.anchor ? 1 : -1;
      const anchor = anchorStuck ? escapeCaretlessLine(newState, sel.$anchor, anchorBias) : null;
      if (anchorStuck && !anchor) return null;

      const fixed = TextSelection.between(
        anchor ? anchor.$head : sel.$anchor,
        head ? head.$head : sel.$head,
      );
      // `between` normalizes, and a normalization that landed back in a
      // caret-less line would be handed straight back for another pass.
      if (inCaretlessLine(fixed.$head) || inCaretlessLine(fixed.$anchor)) return null;
      return newState.tr.setSelection(fixed);
    },
  });
}
