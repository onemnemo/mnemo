/**
 * The "Symbol" slash row, the one place the `\` palette is discoverable from.
 *
 * Nobody knows a backslash does anything, where `/` at least has the empty
 * line hint. The row writes a backslash at the caret and stops: that edit is
 * what raises the palette, so the row inserts nothing else and the user is
 * looking at the same list they would have reached by typing the character.
 */

import type { SlashContribution } from '../registry/types';
import { blockContext } from '../commands/caret-block';

export const symbolSlashRow: SlashContribution = {
  label: 'Symbol',
  description: 'SymbolDescription',
  icon: 'omega',
  keywords: ['greek', 'latex', 'character', 'math', 'arrow', 'unicode'],
  group: 'insert',
  insert: (state, dispatch) => {
    const ctx = blockContext(state);
    if (!ctx || ctx.line.type.spec.code === true) return;
    dispatch(state.tr.insertText('\\').scrollIntoView());
  },
};
