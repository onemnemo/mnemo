/**
 * What Ctrl+A means, which depends on what it has already selected.
 *
 * One chord, two stages: the block you are in, then the whole note. That order
 * is what makes the chord usable in a document made of blocks. Reaching straight
 * for every block puts the note one keystroke from being replaced by whatever you
 * type next, and it is the wrong answer far more often than the right one, since
 * the reason to press Ctrl+A is almost always to retype or reformat the
 * paragraph under the caret. Stopping at the block first costs the other case a
 * second press.
 *
 * The escalation is read off the selection rather than counted. A press whose
 * selection already covers the block has nothing left to do at that stage, so it
 * moves up, and that is true whether the previous press put it there or the user
 * did it by hand. Nothing has to be remembered between keystrokes, so nothing can
 * be remembered wrongly: no stale "second press" surviving a click into another
 * block, no counter to reset.
 *
 * One consequence worth naming: an empty block has no content, so the first press
 * in one goes straight to the whole note. That is the honest reading of "select
 * what is in this block" when the answer is nothing.
 */

import { TextSelection, type EditorState, type Transaction } from 'prosemirror-state';

/** A block's own inline content, as document positions. */
export interface ContentRange {
  readonly from: number;
  readonly to: number;
}

/**
 * The content of the block holding the caret, or null when the selection is not
 * inside one at all (a node selection on an atom, or a selection already spanning
 * the document).
 *
 * The *innermost* textblock, so a table cell means that cell and not the table,
 * and a code block means its source. That is the block the caret is in by every
 * other measure the editor uses, and Ctrl+A must not be the one place it means
 * something else.
 */
export function blockContentRange(state: EditorState): ContentRange | null {
  const { $from, $to } = state.selection;
  if (!$from.parent.isTextblock || !$from.sameParent($to)) return null;
  return { from: $from.start(), to: $from.end() };
}

/** Whether the selection already holds all of `range`, which is what escalates. */
export function selectionCovers(state: EditorState, range: ContentRange): boolean {
  return state.selection.from <= range.from && state.selection.to >= range.to;
}

/** The transaction selecting one block's content. */
export function selectBlockContent(state: EditorState, range: ContentRange): Transaction {
  return state.tr.setSelection(TextSelection.create(state.doc, range.from, range.to));
}

/**
 * Whether this press should take the block or the whole note.
 *
 * `blockSelected` is true when a block selection is already live: the text
 * selection was collapsed to make it, so without this the chord would read the
 * collapsed caret as "stage one again" and give back a single block from a
 * selection of many.
 */
export function selectAllStage(
  state: EditorState,
  blockSelected: boolean,
): { readonly stage: 'block'; readonly range: ContentRange } | { readonly stage: 'document' } {
  if (blockSelected) return { stage: 'document' };
  const range = blockContentRange(state);
  if (range === null || selectionCovers(state, range)) return { stage: 'document' };
  return { stage: 'block', range };
}
