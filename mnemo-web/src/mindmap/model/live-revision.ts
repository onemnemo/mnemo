/**
 * Deciding whether a server change notice means "reload".
 *
 * The host pushes a nudge every time a map commits, including the commits this editor just made. If
 * the editor reloaded on all of them it would refetch the whole document after every keystroke and
 * fight its own optimistic state; if it reloaded on none it would never see an AI tool call or an
 * import. The rule that separates the two is not "who sent it" (the channel does not say) but two
 * counters the editor already has: how many of its own writes are still in flight, and what revision
 * it has already caught up to.
 *
 * Kept free of React and of the network so the rule is testable on its own. The tricky cases are all
 * orderings, and orderings are exactly what a unit test can pin down and a live session cannot.
 */

import type { MindmapDocumentOrder, MindmapRestoreDelta } from "./delta"

export interface LiveRevisionState {
  /** Writes this editor has started and not yet seen the answer to. */
  inFlight: number
  /** The newest revision this editor's own document is known to be at. */
  known: number
}

export interface MindmapChangedNotice {
  mapId: string
  revision: number
  /** The revision the write applied against, which is the one a client must hold to fold it. */
  baseRevision?: number
  kind: "created" | "edited" | "renamed" | "deleted"
  /**
   * The write, when it was small enough for the server to send whole.
   *
   * This is what makes an edit the user did not make undoable. Without it the only honest answer to
   * an assistant rewriting half a map is to refetch and drop the undo stack, which leaves the person
   * who has to review that rewrite with nothing to press.
   */
  undo?: MindmapRestoreDelta | null
  redo?: MindmapRestoreDelta | null
  order?: MindmapDocumentOrder | null
}

export function initialLiveRevision(revision: number): LiveRevisionState {
  return { inFlight: 0, known: revision }
}

export function beginWrite(state: LiveRevisionState): LiveRevisionState {
  return { ...state, inFlight: state.inFlight + 1 }
}

/**
 * A write finished. `revision` is what the server reported, which is also true of a rejected write:
 * a conflict body carries the revision the map is actually on, and adopting it is what stops the
 * next notice from being read as news.
 */
export function endWrite(state: LiveRevisionState, revision: number): LiveRevisionState {
  return {
    inFlight: Math.max(0, state.inFlight - 1),
    known: Math.max(state.known, revision),
  }
}

/** The document was replaced wholesale (an initial load or a refetch). */
export function adoptRevision(state: LiveRevisionState, revision: number): LiveRevisionState {
  return { ...state, known: Math.max(state.known, revision) }
}

export type LiveRevisionAction = "ignore" | "fold" | "reload" | "closed"

/**
 * What to do about a change notice.
 *
 * - A notice for another map is not ours.
 * - A deletion means the map is gone; the editor closes rather than reloading a document that is
 *   not there.
 * - A revision we already have is our own echo, or a duplicate.
 * - Anything still in flight is our own edit arriving before its own response did. Reloading here
 *   would race the response and throw away the optimistic state we are about to reconcile; the
 *   response carries the same revision and updates `known` when it lands, so the news is not lost,
 *   only deferred by a few milliseconds.
 * - A notice that carries its own deltas and applied against exactly the revision we hold is
 *   somebody else's write we can absorb: fold it and push one undo entry, so it is one Ctrl+Z to
 *   take back rather than a refetch that empties the stack.
 *
 * Folding is gated on nothing being in flight, which is stricter than it has to be and is meant to
 * be. A write we have not heard back from is about to move the document under us; absorbing another
 * one first would leave the answer to ours describing a revision it never saw.
 *
 * The one thing this deliberately does not do is drop a notice that arrives while a write is in
 * flight but describes a *different, higher* revision. That is a real interleave, and the write's
 * own response will report an interleave too, so both paths agree the client has to refetch.
 */
export function classify(
  state: LiveRevisionState,
  notice: MindmapChangedNotice,
  openMapId: string,
): LiveRevisionAction {
  if (notice.mapId !== openMapId) {
    return "ignore"
  }
  if (notice.kind === "deleted") {
    return "closed"
  }
  if (notice.revision <= state.known) {
    return "ignore"
  }
  if (state.inFlight > 0) {
    return notice.revision === state.known + 1 ? "ignore" : "reload"
  }
  return foldable(state, notice) ? "fold" : "reload"
}

function foldable(state: LiveRevisionState, notice: MindmapChangedNotice): boolean {
  return (
    notice.baseRevision === state.known &&
    notice.undo != null &&
    notice.redo != null &&
    notice.order != null
  )
}
