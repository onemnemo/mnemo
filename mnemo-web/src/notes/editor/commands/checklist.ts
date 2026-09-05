/**
 * Checking and unchecking a to-do from the caret.
 *
 * The item's checkbox is a real button in its node view, but a pointer was the
 * only thing that could reach it: Tab inside a list item belongs to the nesting
 * keys, and a control the editor's own keys cannot get to is a control some
 * people do not have. So the checked state is a command on the caret's block,
 * the same edit the button dispatches, and the box itself is no longer a tab
 * stop.
 */

import type { Command, EditorState } from 'prosemirror-state';
import { asOwnUndoStep } from '../history';
import { blockContext, type BlockContext } from './caret-block';

/** The caret's checklist item, or null when the caret is not in one. */
function checklistAtCaret(state: EditorState): BlockContext | null {
  const ctx = blockContext(state);
  return ctx && ctx.block.type.name === 'checklistItem' ? ctx : null;
}

/** Whether the caret sits in a to-do that is checked, for a surface that shows state. */
export function isChecklistItemChecked(state: EditorState): boolean {
  return checklistAtCaret(state)?.block.attrs.checked === true;
}

/**
 * Flips the caret's to-do. Declines everywhere else, so the chord it is bound to
 * keeps whatever meaning it has outside a checklist.
 */
export const toggleChecklistItem: Command = (state, dispatch) => {
  const ctx = checklistAtCaret(state);
  if (!ctx) return false;
  if (dispatch) {
    const tr = state.tr.setNodeMarkup(ctx.blockPos, undefined, {
      ...ctx.block.attrs,
      checked: ctx.block.attrs.checked !== true,
    });
    dispatch(asOwnUndoStep(tr));
  }
  return true;
};
