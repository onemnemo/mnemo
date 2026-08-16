/**
 * Where one undo step ends and the next begins.
 *
 * ProseMirror groups by time and adjacency, which is right for typing and wrong
 * for everything else: a paste landing where you were just typing is adjacent and
 * fast, so by default it joins the typing run and one `Mod-z` takes back both. The
 * desktop never had that problem because a structural change went down a
 * different path, `BeginStructuralChange` flushed the open typing batch before
 * capturing, and pushed its own entry after. So a structural edit was fenced on
 * *both* sides, and that is what this file restores.
 *
 * ## Both sides, from two places
 *
 * The near side is the transaction itself: {@link asOwnUndoStep} closes the group
 * before it, so it cannot join what came before. The far side has to be a second
 * transaction, because the group a transaction opens can only be closed by a later
 * one, that is {@link historyBoundaryPlugin}'s `appendTransaction`, which carries
 * no steps and so costs a state apply and no re-render.
 *
 * Paste, cut and drop are ProseMirror's own transactions, not ours, so their near
 * side is a DOM handler that closes the group and then declines the event, leaving
 * ProseMirror to do the actual work.
 *
 * ## Two boundaries the desktop needed and this does not
 *
 * `CompleteLostFocus` flushed the typing batch when focus left a block, and a
 * 300ms timer flushed it when typing stopped. Both existed because an open batch
 * was a live object that had to be closed by *something*. ProseMirror decides
 * grouping when the next transaction arrives, looking back at how long ago the
 * last one was, so a run that ended is already closed by the time anything cares,
 * and there is nothing to close on the way out. Dispatching on blur would also be
 * actively harmful: the equation source popover takes focus out of the editor by
 * design, and a transaction dispatched from that blur is a chance to pull the
 * caret back.
 *
 * A note switch needs no boundary either. The desktop cleared one long-lived
 * `HistoryManager` (`BlockEditor.axaml.cs:363-366`) because the manager outlived
 * the note; here the view and its state are destroyed and rebuilt, so the new
 * note's history starts empty because it is a different history.
 */

import { closeHistory } from 'prosemirror-history';
import { Plugin, PluginKey, type Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

const boundaryKey = new PluginKey<boolean>('mnemo-history-boundary');

/** ProseMirror's own tag for the transactions it raises from a UI gesture. */
const BOUNDARY_UI_EVENTS: ReadonlySet<unknown> = new Set(['paste', 'cut', 'drop']);

/**
 * Mark a transaction as an edit of its own, one `Mod-z`, no more and no less.
 *
 * Every structural command uses this: a split, a merge, a block delete, a type
 * conversion. These are the desktop's `DocumentOperation`s, and the property that
 * matters is not that they are structural but that they are *discrete*. Typing is
 * the only edit a user thinks of as continuous.
 */
export function asOwnUndoStep(tr: Transaction): Transaction {
  return closeHistory(tr).setMeta(boundaryKey, true);
}

function isBoundary(tr: Transaction): boolean {
  if (tr.getMeta(boundaryKey) === true) return true;
  return BOUNDARY_UI_EVENTS.has(tr.getMeta('uiEvent'));
}

/** Closes the group, then declines the event so ProseMirror handles it as usual. */
function closeBeforeEvent(view: EditorView): boolean {
  view.dispatch(closeHistory(view.state.tr));
  return false;
}

/**
 * Fences discrete edits off from the typing runs on either side of them.
 *
 * Include it after the history plugin. It changes no document and holds no state;
 * every decision is read off the transactions themselves.
 */
export function historyBoundaryPlugin(): Plugin {
  return new Plugin({
    props: {
      handleDOMEvents: {
        paste: closeBeforeEvent,
        cut: closeBeforeEvent,
        drop: closeBeforeEvent,
      },
    },
    appendTransaction(trs, _oldState, newState) {
      // Only the far side here. The near side is already on the transaction, put
      // there by `asOwnUndoStep` or by the DOM handler above.
      return trs.some(isBoundary) ? closeHistory(newState.tr) : null;
    },
  });
}
