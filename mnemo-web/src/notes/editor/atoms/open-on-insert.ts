/**
 * The seam between inserting an inline equation and opening its source editor.
 *
 * A command builds a transaction and knows nothing about views; only the atom's
 * NodeView can open the source card, and that view is built while the
 * transaction is still being applied. So the command marks its transaction with
 * the position it put the atom at, this plugin holds the mark, and the view asks
 * whether it is the atom that was asked for.
 *
 * The mark outlives the transaction that set it, because a dispatch is rarely
 * one transaction: the identity, invariant and caret plugins append their own,
 * and the state the view is finally built from is the last of them. It follows
 * the atom through every mapping until the view that opens the card consumes it,
 * or until the atom is gone, so a view rebuilt later (a redraw, an undo, a
 * remount) opens nothing.
 */

import { Plugin, PluginKey, type EditorState, type Transaction } from 'prosemirror-state';

const openKey = new PluginKey<number | null>('mnemo-equation-open-on-insert');

const CONSUMED = 'consumed';

/** Asks the view built for the atom at `pos` to open its source editor. */
export function openEditorOnInsert(tr: Transaction, pos: number): Transaction {
  return tr.setMeta(openKey, pos);
}

/** Clears the request once a view has answered it. */
export function consumeOpenOnInsert(tr: Transaction): Transaction {
  return tr.setMeta(openKey, CONSUMED);
}

/** Whether the state asks to edit the atom at `pos`. */
export function opensEditorAt(state: EditorState, pos: number): boolean {
  return openKey.getState(state) === pos;
}

export function equationOpenOnInsert(): Plugin<number | null> {
  return new Plugin<number | null>({
    key: openKey,
    state: {
      init: () => null,
      apply: (tr, previous) => {
        const meta: unknown = tr.getMeta(openKey);
        if (meta === CONSUMED) return null;
        if (typeof meta === 'number') return meta;
        if (previous === null) return null;
        const mapped = tr.mapping.map(previous, -1);
        return tr.doc.nodeAt(mapped)?.type.name === 'equationSpan' ? mapped : null;
      },
    },
  });
}
