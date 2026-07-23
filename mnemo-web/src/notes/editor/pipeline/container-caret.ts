/**
 * Keeps the caret out of container lines.
 *
 * A two-column and its cells each carry the mandatory structural line every
 * block has, but theirs hold no user content and the CSS hides them. A caret
 * that lands in one, arrow keys walk into it from either side, would be
 * invisible, and a structural command run there would treat the container
 * itself as the caret's block. This guard relocates such a selection to the
 * nearest real line, in the direction the selection was moving, so an arrow
 * key appears to step straight across the hidden line.
 */

import type { ResolvedPos } from 'prosemirror-model';
import { Plugin, PluginKey, Selection, TextSelection, type EditorState } from 'prosemirror-state';
import { containerBlockNames } from '../blocks/shared';

/** True when the position sits inside the structural line of a container block. */
export function inContainerLine($pos: ResolvedPos): boolean {
  if ($pos.depth < 1 || !$pos.parent.isTextblock) return false;
  const owner = $pos.node($pos.depth - 1);
  // The line is always the container's first child.
  return containerBlockNames.has(owner.type.name) && $pos.index($pos.depth - 1) === 0;
}

/**
 * The nearest selection outside any container line, searching in `bias`
 * direction first and flipping if that side of the document runs out. Null when
 * no real line exists anywhere, which a non-empty document cannot produce.
 */
function escapeContainerLine(state: EditorState, bias: 1 | -1): Selection | null {
  let $pos = state.selection.$head;
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
    if (!inContainerLine(found.$head)) return found;
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
      if (!inContainerLine(sel.$head)) return null;
      // The direction the selection travelled decides which real line reads as
      // "the next one over"; a fresh click has no travel and falls forward.
      const bias: 1 | -1 = sel.head >= oldState.selection.head ? 1 : -1;
      const escaped = escapeContainerLine(newState, bias);
      if (!escaped || inContainerLine(escaped.$head)) return null;
      const fixed = sel.empty
        ? escaped
        : TextSelection.between(sel.$anchor, escaped.$head);
      return newState.tr.setSelection(fixed);
    },
  });
}
