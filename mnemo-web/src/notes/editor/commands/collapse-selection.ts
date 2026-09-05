/**
 * Escape on a marked run of text: the run is dropped and the caret stays at the
 * end the user was moving.
 *
 * The last step of one escalation. Escape clears a block selection first, and
 * closes find before that; only when neither is up does a text range answer,
 * which is why this is mounted below both rather than beside the structural
 * keys. Collapsing to the head, not to the anchor, is what makes it feel like
 * the selection stopped growing rather than jumped back.
 */

import { keymap } from 'prosemirror-keymap';
import { TextSelection, type Command, type Plugin } from 'prosemirror-state';

export const collapseTextSelection: Command = (state, dispatch) => {
  const sel = state.selection;
  if (!(sel instanceof TextSelection) || sel.empty) return false;
  if (dispatch) {
    dispatch(state.tr.setSelection(TextSelection.create(state.doc, sel.head)).scrollIntoView());
  }
  return true;
};

/** The keymap plugin, mounted below every other Escape in the stack. */
export function collapseSelectionKeymap(): Plugin {
  return keymap({ Escape: collapseTextSelection });
}
