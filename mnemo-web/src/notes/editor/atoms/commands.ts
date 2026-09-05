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
 * ## The selection is the source
 *
 * The only surface that offers this is the formatting toolbar, which appears
 * over a selection, so a press means "make this an equation". Discarding the
 * selected text and inserting an empty atom took what the user had highlighted
 * and left nothing on screen in its place, because an equation with no source
 * typesets to nothing. The desktop's convert path reads the same text and
 * strips one layer of `$` delimiters off it, so that is what this does too.
 * Atoms inside the range project through the same text the plain text
 * projection gives them, so a fraction becomes `n/d` rather than vanishing.
 *
 * Opening the editor is still the NodeView's job and needs a mounted view. The
 * command only records which atom to open, on the transaction; `open-on-insert`
 * carries that across.
 */

import type { Command } from 'prosemirror-state';
import { asOwnUndoStep } from '../history';
import { atomProjector } from '../blocks/shared';
import { inlineModules } from '../schema/inlines';
import { normalizeEquationLatex } from '../../model/format';
import { openEditorOnInsert } from './open-on-insert';

const projectAtom = atomProjector(inlineModules);

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
      const source = latex || normalizeEquationLatex(state.doc.textBetween(from, to, undefined, projectAtom));
      let tr = state.tr.replaceRangeWith(from, to, type.create({ latex: source }));
      // Asked for only where the atom actually landed: `replaceRange` may widen
      // the range it replaces, and an editor opened on the wrong position would
      // edit the wrong node.
      const at = tr.mapping.map(from, -1);
      if (tr.doc.nodeAt(at)?.type === type) tr = openEditorOnInsert(tr, at);
      // Inserting an atom is its own undo step: one press takes the equation
      // back out and leaves whatever it replaced, rather than unwinding into the
      // typing that happened to precede it.
      dispatch(asOwnUndoStep(tr.scrollIntoView()));
    }
    return true;
  };
}
