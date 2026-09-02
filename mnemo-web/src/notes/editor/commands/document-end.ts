/**
 * Getting the caret out of the block a note ends with.
 *
 * A block whose Enter is a newline rather than a split (source, a table cell, a
 * soft-wrapped quote) is a dead end when it is the last thing in the note: Enter,
 * Shift+Enter and Ctrl+Enter all add lines to it, the arrows have nowhere to go
 * because there is no next position in the document, and a mouse click in the
 * space below the last block is the only way back to prose. So the two keys that
 * mean "onwards", ArrowRight and ArrowDown, make the block that is missing.
 */

import { TextSelection, type Command, type EditorState } from 'prosemirror-state';
import { asOwnUndoStep } from '../history';

/** Whether the caret sits at the very last position the document has, at every level. */
function caretAtDocumentEnd(state: EditorState): boolean {
  const { $from } = state.selection;
  // doc > block > line at the shallowest, and the caret has to be in the line.
  if (!$from.parent.isTextblock || $from.depth < 2) return false;
  if ($from.parentOffset !== $from.parent.content.size) return false;
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.index(depth - 1) !== $from.node(depth - 1).childCount - 1) return false;
  }
  return true;
}

/**
 * Whether Enter, pressed where the caret is, would leave a block after the
 * caret's own.
 *
 * Asked of the split command itself rather than of a list of block types: these
 * keys exist for the blocks whose Enter is a newline, and a list of those would
 * drift the moment that ladder changes. The dry run dispatches nothing; it reads
 * how much document sits past the caret's block before and after, so a break
 * inserted inside the line counts as no escape and a sibling inserted at any
 * level counts as one.
 */
function enterLeavesABlockBelow(state: EditorState, split: Command): boolean {
  const { $from } = state.selection;
  const blockEnd = $from.after($from.depth - 1);
  const tailBefore = state.doc.content.size - blockEnd;
  let tailAfter = tailBefore;
  split(state, (tr) => {
    tailAfter = tr.doc.content.size - tr.mapping.map(blockEnd, -1);
  });
  return tailAfter > tailBefore;
}

/**
 * ArrowRight and ArrowDown at the end of the last block: append an empty Text
 * block and put the caret in it.
 *
 * Declined everywhere else, including at the end of an ordinary paragraph, where
 * Enter already makes the block below and a key that quietly grew the note on a
 * caret motion would be a surprise.
 */
export function escapeLastBlock(split: Command): Command {
  return (state, dispatch) => {
    const sel = state.selection;
    if (!(sel instanceof TextSelection) || !sel.empty) return false;
    if (!caretAtDocumentEnd(state)) return false;
    if (enterLeavesABlockBelow(state, split)) return false;

    if (dispatch) {
      const { paragraph, line } = state.schema.nodes;
      const at = state.doc.content.size;
      const tr = state.tr.insert(at, paragraph.create(null, line.create()));
      tr.setSelection(TextSelection.create(tr.doc, at + 2));
      dispatch(asOwnUndoStep(tr.scrollIntoView()));
    }
    return true;
  };
}
