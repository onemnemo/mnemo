/**
 * Creating an inline equation.
 *
 * A command, not a menu entry. The slash menu, the keymap and the toolbar are
 * later surfaces (M8, M6) that decide *how* an equation is offered; this decides
 * *what* offering one does, so those surfaces share one behaviour instead of
 * each reimplementing the insert. Only the equation has this — the fraction has
 * no creation affordance until there is evidence anyone wants one, and the
 * block-level Equation type has none until it has an editing contract, so that
 * nothing discoverable can create an object a user cannot then repair.
 *
 * The command inserts the atom and stops. Opening its editor is the NodeView's
 * job and needs a mounted view, which arrives with M6; an equation created here
 * is edited by the same path as any other — click it.
 */

import type { Command } from 'prosemirror-state';
import { asOwnUndoStep } from '../history';

export function insertEquation(latex = ''): Command {
  return (state, dispatch) => {
    const type = state.schema.nodes.equationSpan;
    if (!type) return false;

    // Only where the surrounding content model actually admits an inline atom.
    // A code block's content is plain text, so this refuses there rather than
    // producing a document the schema would reject.
    const { $from } = state.selection;
    const index = $from.index();
    if (!$from.parent.canReplaceWith(index, index, type)) return false;

    if (dispatch) {
      // Replace the selection range directly: a collapsed caret inserts, a
      // non-empty selection is overwritten. Being explicit about the range keeps
      // the inline atom inline rather than leaning on selection-shape heuristics.
      const { from, to } = state.selection;
      // Inserting an atom is its own undo step: one press takes the equation
      // back out and leaves whatever it replaced, rather than unwinding into the
      // typing that happened to precede it.
      dispatch(
        asOwnUndoStep(
          state.tr.replaceRangeWith(from, to, type.create({ latex })).scrollIntoView(),
        ),
      );
    }
    return true;
  };
}
