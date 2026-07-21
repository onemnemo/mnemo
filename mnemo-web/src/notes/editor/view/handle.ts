/**
 * The live editor handle: the `EditorHandle` over a real `EditorView`.
 *
 * `authority/handle.ts` defines the contract and the headless implementation and
 * says this file has to exist — the authority drives a visible note through the
 * same interface as a headless one, and only this knows a view is involved.
 *
 * The one thing it must not do is `view.dispatch(tr)`. That returns nothing, and
 * the transactions invariant plugins append through `appendTransaction` would be
 * lost — the version counter would then count one logical edit as one
 * transaction and miss the rest. So it does what the headless handle does:
 * `applyTransaction` for the *full* list, then `view.updateState` with the
 * result. `updateState` sets the state directly rather than re-dispatching, so
 * the appended transactions are applied exactly once.
 */

import type { EditorView } from 'prosemirror-view';
import type { EditorState } from 'prosemirror-state';
import type { AppliedChange, EditorHandle } from '../../authority/handle';

export function createViewHandle(view: EditorView): EditorHandle {
  let alive = true;
  let last: EditorState | null = null;

  return {
    get state() {
      // After teardown this answers with the last state the view held. Closing a
      // note destroys the editor immediately — a teardown that waited for the
      // network would leave a live view in the DOM across a note switch — while
      // the final save is still in flight behind it, and that save has to be
      // able to read the document it is committing.
      return alive ? view.state : last!;
    },

    apply(tr): AppliedChange {
      if (!alive) throw new Error('This editor handle has been destroyed.');
      // Read the live state, not one captured at construction: user typing goes
      // through the view's own dispatch, so `view.state` is the only current doc.
      const applied = view.state.applyTransaction(tr);
      view.updateState(applied.state);
      return { state: applied.state, transactions: applied.transactions };
    },

    destroy(): void {
      // Idempotent: the mount owns teardown and the authority also calls this on
      // its own destroy, so both can fire. `EditorView.destroy` is not safe to
      // call twice, hence the guard.
      if (!alive) return;
      alive = false;
      last = view.state;
      view.destroy();
    },
  };
}
