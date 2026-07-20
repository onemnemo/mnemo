/**
 * The imperative editor handle: the seam between the authority and whatever is
 * actually holding the document.
 *
 * The authority never touches an `EditorView`, so the same authority drives a
 * visible note and a headless one. Only this file knows which it is.
 *
 * The contract is deliberately narrow — read the state, apply a transaction —
 * but `apply` returns *every* transaction the apply produced, not just the one
 * that went in. That is the part the authority cannot do without: invariant
 * plugins append transactions through `appendTransaction`, and a version
 * counter that could not see them would count one logical edit as several.
 */

import type { EditorState, Transaction } from 'prosemirror-state';

export interface AppliedChange {
  readonly state: EditorState;
  /** The dispatched transaction first, then whatever plugins appended to it. */
  readonly transactions: readonly Transaction[];
}

export interface EditorHandle {
  readonly state: EditorState;
  apply(tr: Transaction): AppliedChange;
  destroy(): void;
}

/**
 * A handle over a bare `EditorState`, for a note with no view attached.
 *
 * The view layer supplies the live one. It cannot simply call `view.dispatch(tr)`, because
 * that returns nothing and the appended transactions would be lost; it has to
 * do what this does — `applyTransaction` for the full list, then
 * `view.updateState` with the result.
 */
export function createHeadlessHandle(initial: EditorState): EditorHandle {
  let state = initial;
  let alive = true;

  return {
    get state() {
      return state;
    },

    apply(tr: Transaction): AppliedChange {
      if (!alive) throw new Error('This editor handle has been destroyed.');
      const applied = state.applyTransaction(tr);
      state = applied.state;
      return { state: applied.state, transactions: applied.transactions };
    },

    destroy(): void {
      alive = false;
    },
  };
}
