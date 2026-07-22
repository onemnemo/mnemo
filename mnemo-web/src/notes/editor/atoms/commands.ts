/**
 * Creating an inline equation.
 *
 * A command, not a menu entry. The slash menu, the keymap and the toolbar are
 * later surfaces that decide *how* an equation is offered; this decides
 * *what* offering one does, so those surfaces share one behaviour instead of
 * each reimplementing the insert. Only the equation has this, the fraction has
 * no creation affordance until there is evidence anyone wants one, and the
 * block-level Equation type has none until it has an editing contract, so that
 * nothing discoverable can create an object a user cannot then repair.
 *
 * The command inserts the atom and stops. Opening its editor is the NodeView's
 * job and needs a mounted view; an equation created here
 * is edited by the same path as any other, click it.
 */

import type { Command } from 'prosemirror-state';
import { asOwnUndoStep } from '../history';

export function insertEquation(latex = ''): Command {
  return (state, dispatch) => {
    const type = state.schema.nodes.equationSpan;
    if (!type) return false;

    const { $from } = state.selection;

    // A source line admits an atom in the schema, but only so wire data that
    // already contains one survives the round trip. Creating one there is a
    // different thing: it drops an equation into the middle of code the user
    // then cannot edit as code. Availability is this dry run, so refusing here
    // is also what greys the toolbar button out.
    if ($from.parent.type.spec.code) return false;

    // Only where the surrounding content model actually admits an inline atom.
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
