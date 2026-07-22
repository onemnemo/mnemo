/**
 * The one thing a slash-menu row does: turn the block the caret is in into the
 * block the row names, and take the typed `/query` with it.
 *
 * Every row goes through `convertBlockType`, so the block keeps its id, sid,
 * order and meta. That matters more here than it looks: a sid is the name the
 * AI has already seen and quoted back, and a delete-and-reinsert would mint a
 * new one for what the user experiences as the same block changing shape.
 *
 * The line is cleared rather than kept, matching the desktop, and the trigger
 * text goes with it: the `/query` was a command, not content. The menu only
 * opens on a line with no inline atom, so clearing cannot destroy an equation
 * that carries no text of its own.
 */

import { TextSelection } from 'prosemirror-state';
import { blockContext, convertBlockType } from '../commands/structure';
import type { SlashContribution } from '../registry/types';

export function convertHere(
  nodeName: string,
  attrs?: Record<string, unknown>,
): SlashContribution['insert'] {
  return (state, dispatch) => {
    const ctx = blockContext(state);
    if (!ctx) return;
    const target = state.schema.nodes[nodeName];
    if (!target) return;

    const tr = state.tr;
    convertBlockType(tr, ctx.blockPos, ctx.block, target, { attrs, content: 'clear' });
    // Two positions in: past the block's own boundary and past the line's.
    tr.setSelection(TextSelection.create(tr.doc, ctx.blockPos + 2));
    dispatch(tr.scrollIntoView());
  };
}
