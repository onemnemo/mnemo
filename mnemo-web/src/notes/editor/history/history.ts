/**
 * Undo and redo for the note editor.
 *
 * The desktop ran two parallel mechanisms over one stack: a `DocumentOperation`
 * holding a full before/after snapshot of every block, pushed once per structural
 * change, and a `TextEditOperation` holding one block's inline runs, opened on the
 * first keystroke and closed on an idle timer. ProseMirror's history keeps
 * inverted steps instead of snapshots and decides grouping per transaction, so
 * the two operation classes do not survive as classes, they survive as *grouping*,
 * which is all the user ever saw of them.
 *
 * ## The 300ms is the same 300ms
 *
 * `TypingBatchIdleMs` (`BlockEditor.axaml.cs:131`) restarted a timer on every
 * keystroke, so it measured the gap *since the last edit*, not since the first.
 * `newGroupDelay` is measured the same way, `prevTime` is rewritten by every
 * transaction, so the number ports across with its meaning intact rather than
 * looking similar and behaving differently.
 *
 * ## What a repair belongs to
 *
 * The invariant pipeline, the list numbering and the identity plugin all react
 * through `appendTransaction`. ProseMirror excludes appended transactions from
 * starting a new group (`applyTransaction`: the `newGroup` test is guarded by
 * `!appended`), so a repair is folded into the edit that provoked it. Typing into
 * a heading and having its bold forced back on is one undo, not two, which is
 * what the desktop got from ordering the flush before the structural capture, by
 * a completely different route.
 *
 * The other half of that does not come free: a repair plugin will just as
 * happily react to an *undo*, repairing the document back into the state the
 * undo took it out of. See {@link isHistoryRestore}.
 *
 * ## Three deliberate divergences
 *
 *  - **The stack is bounded.** `HistoryManager` had no cap at all; it could hold
 *    a full document snapshot per structural edit for as long as a note stayed
 *    open. ProseMirror's default of 100 events is kept, and it costs far less per
 *    event because an event is a set of inverted steps.
 *  - **Undo restores a selection, not just a caret.** `CaretState` recorded one
 *    offset, so undoing a change made to a selected range put the caret back but
 *    not the range. ProseMirror bookmarks the whole selection when a group opens.
 *  - **A typing run is bounded by position, not only by block.** The desktop
 *    coalesced every keystroke in one block into a single entry however far apart
 *    they landed; ProseMirror also ends the run when an edit is not adjacent to
 *    the previous one. Typing at the end of a paragraph, clicking to its start and
 *    typing again is two undo steps here and was one there. Finer is better here,
 *    and it is also what makes a block switch a boundary for free.
 */

import { history, redo as pmRedo, undo as pmUndo } from 'prosemirror-history';
import { PluginKey, type Command, type Plugin, type Transaction } from 'prosemirror-state';

const restoreKey = new PluginKey<boolean>('mnemo-history-restore');

/**
 * Whether a transaction is history putting a document back, rather than someone
 * changing it.
 *
 * The desktop asked this with `_isRestoringFromHistory`, a field set for the
 * duration of a restore and cleared through the dispatcher afterwards so that
 * bindings still settling would see it. Rated severe, and fairly: the flag was
 * right or wrong depending on when you read it, and a restore that threw left it
 * stuck on. The question survives the port because our own `appendTransaction`
 * plugins would otherwise repair a document back into the state undo just took it
 * out of, but the answer travels on the transaction it is about, so there is no
 * window in which it is set, no clear to defer, and nothing to leak.
 */
export function isHistoryRestore(tr: Transaction): boolean {
  return tr.getMeta(restoreKey) === true;
}

function markRestore(command: Command): Command {
  return (state, dispatch) =>
    command(state, dispatch && ((tr) => dispatch(tr.setMeta(restoreKey, true))));
}

/**
 * Undo and redo, tagged so the rest of the editor can tell a restore from an
 * edit. Behaviourally they are `prosemirror-history`'s own.
 */
export const undo: Command = markRestore(pmUndo);
export const redo: Command = markRestore(pmRedo);

/**
 * The idle gap that closes a typing run, in milliseconds. The desktop's
 * `TypingBatchIdleMs`, unchanged.
 */
export const TYPING_GROUP_DELAY_MS = 300;

/**
 * The history plugin for an editable note.
 *
 * Read-only states deliberately do not get one: nothing can change the document,
 * so an undo stack would only ever be empty, and mounting one would let a stray
 * `Mod-z` look like it had failed rather than never having applied.
 */
export function editorHistory(): Plugin {
  return history({ newGroupDelay: TYPING_GROUP_DELAY_MS });
}
