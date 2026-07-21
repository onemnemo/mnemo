/**
 * The document authority: one per loaded note, owning its document, its
 * versions and its save state, and serializing everything that touches them.
 *
 * Every writer goes through here — typing, undo, import, AI edits, autosave —
 * so there is exactly one place where a document changes and exactly one place
 * where a version moves. That is the whole point of the single-writer seam: two
 * writers with their own version counters is how a save silently overwrites an
 * edit that was never persisted.
 *
 * ## Two counters, deliberately
 *
 * `ver` and `rev` are not the same number and must not be conflated.
 *
 * - **`ver`** is the *persisted* version: what the store holds, and the base
 *   for the next commit. It only ever moves when a commit lands, and it is set
 *   from what the store reports rather than computed here — the store assigns
 *   it, and a client that guessed would be wrong the moment anyone else wrote.
 * - **`rev`** is the *local* revision: it increments once per converged logical
 *   change, and never decreases. It is what "dirty" is measured against.
 *
 * Five edits then one save leaves `rev` five ahead of where it started and
 * `ver` one ahead — the two count different things. Collapsing them into one
 * counter loses the ability to say whether the document currently in memory is
 * the one that was persisted, which is precisely what a late save
 * acknowledgement has to ask before it clears the dirty flag.
 *
 * ## What "one increment per logical change" means
 *
 * One dispatch is one logical change, however many transactions it turns into.
 * Invariant plugins append transactions to normalize what an edit did; those
 * are part of the same change converging, not further changes. A dispatch that
 * leaves the document untouched — a selection move — is not a change at all and
 * moves nothing.
 *
 * ## What lives outside
 *
 * Note metadata (title, folder, favourite) is not here. Those writes go
 * straight to the store and never touch the document, so routing them through a
 * document authority would only invent a version conflict between two things
 * that cannot conflict.
 */

import type { Node as PMNode } from 'prosemirror-model';
import type { EditorState, Transaction } from 'prosemirror-state';

import { createHeadlessHandle, type EditorHandle } from './handle';
import { createCommandQueue } from './queue';

/**
 * The visible save state.
 *
 * Autosave owns this state machine and the policy that drives it, debounce, retry
 * backoff, recovery export. The authority drives only the transitions it causes
 * itself: `loaded`, `dirty`, `saving`, `saved`, `version_conflict` and
 * `save_failed`. The rest are here because they are the shared vocabulary autosave
 * fills in, not because anything sets them yet.
 */
export type SaveState =
  | 'loading'
  | 'loaded'
  | 'dirty'
  | 'saving'
  | 'saved'
  | 'retrying'
  | 'save_failed'
  | 'version_conflict'
  | 'recovered'
  | 'invalid_document';

/**
 * A consistent read of everything the authority owns.
 *
 * Reading the document and the version has to be one operation. It is not
 * enough for each getter to be correct on its own: a caller that reads the doc,
 * awaits anything, then reads the version has read two different moments and
 * will commit one document under another's version. There is no separate `doc`
 * or `ver` accessor for exactly that reason — the torn read is not expressible.
 */
export interface NoteSnapshot {
  readonly noteId: string;
  readonly sid: string;
  readonly doc: PMNode;
  /** The persisted version this document is based on. */
  readonly ver: number;
  /** The local revision of this document. */
  readonly rev: number;
  readonly saveState: SaveState;
  /** Whether this document differs from what was last persisted. */
  readonly dirty: boolean;
}

/** What one dispatch did. */
export interface DispatchResult {
  /** The revision after the dispatch — unchanged if it changed nothing. */
  readonly rev: number;
  /** Whether it counted as a logical change. */
  readonly changed: boolean;
}

/**
 * The unqueued primitives a command runs against.
 *
 * A command already holds the queue, so nothing here queues again. This is what
 * keeps re-entrant deadlock out of reach rather than merely documented.
 */
export interface AuthorityAccess {
  readonly state: EditorState;
  snapshot(): NoteSnapshot;
  apply(tr: Transaction): DispatchResult;
}

/**
 * What the store said about a commit.
 *
 * `AlreadyApplied` from the C# store maps to `applied`: a retry whose original
 * response was lost did land, and reporting it as anything else would turn a
 * dropped acknowledgement into a conflict the user has to resolve by hand.
 * `NotFound` maps to `failed` — the note is gone, and no version the caller
 * could rebase onto exists.
 */
export type CommitOutcome =
  | { readonly status: 'applied'; readonly ver: number }
  | { readonly status: 'conflict'; readonly ver: number }
  | { readonly status: 'failed'; readonly error: unknown };

export type SaveResult =
  | { readonly status: 'skipped' }
  | { readonly status: 'saved'; readonly ver: number; readonly stillDirty: boolean }
  | { readonly status: 'conflict'; readonly ver: number }
  | { readonly status: 'failed'; readonly error: unknown };

/** Persists a snapshot. The authority owns the bookkeeping; the caller owns the transport. */
export type Persist = (snapshot: NoteSnapshot) => Promise<CommitOutcome>;

export interface NoteAuthority {
  readonly noteId: string;
  snapshot(): NoteSnapshot;
  /** Applies one transaction, serialized against everything else. */
  dispatch(tr: Transaction): Promise<DispatchResult>;
  /**
   * Applies one transaction *synchronously*, without going through the queue.
   *
   * This exists for exactly one caller: the `EditorView`'s own
   * `dispatchTransaction`. A view cannot be driven by the queued `dispatch`.
   * ProseMirror builds a transaction from `view.state.tr` inside its DOM-change
   * reader and dispatches it while the browser has *already* mutated the
   * contenteditable; deferring `updateState` even by a microtask leaves the
   * state describing a document the DOM no longer matches, and the next
   * observer flush diffs against that stale doc — which duplicates or drops
   * what was typed.
   *
   * Skipping the queue does not create a second writer. The queue serializes
   * writers that *await* — a save round trip, an AI edit — and a synchronous
   * apply cannot interleave with one: it runs to completion before any pending
   * continuation gets the thread. What it does mean is that a command holding
   * the queue across an await may find the document changed underneath it when
   * it resumes, which is why `AuthorityAccess.apply` reads the live state
   * rather than one captured when the command started.
   */
  dispatchLocal(tr: Transaction): DispatchResult;
  /** Runs a command with exclusive access to the document. */
  run<T>(command: (access: AuthorityAccess) => T | Promise<T>): Promise<T>;
  save(persist: Persist): Promise<SaveResult>;
  subscribe(listener: (snapshot: NoteSnapshot) => void): () => void;
  /** Resolves once everything queued so far has settled. For shutdown and tests. */
  drain(): Promise<void>;
  destroy(): void;
}

export interface AuthorityOptions {
  readonly noteId: string;
  readonly sid: string;
  /** The version the document was loaded at. */
  readonly ver: number;
  readonly state: EditorState;
  /** Supplied by the view layer for a visible note; defaults to headless. */
  readonly handle?: EditorHandle;
}

export function createNoteAuthority(options: AuthorityOptions): NoteAuthority {
  const { noteId, sid } = options;
  const handle = options.handle ?? createHeadlessHandle(options.state);
  const queue = createCommandQueue();
  const listeners = new Set<(snapshot: NoteSnapshot) => void>();

  let ver = options.ver;
  let rev = 0;
  /** The revision that was last persisted. Dirty is `rev > savedRev`. */
  let savedRev = 0;
  let saveState: SaveState = 'loaded';
  let destroyed = false;

  function snapshot(): NoteSnapshot {
    return { noteId, sid, doc: handle.state.doc, ver, rev, saveState, dirty: rev > savedRev };
  }

  function notify(): void {
    const current = snapshot();
    // Iterated live rather than over a copy: a listener removed part-way
    // through a notification should not still be called. `Set` iteration
    // already tolerates a listener removing itself, so a copy would buy nothing
    // and cost that.
    for (const listener of listeners) listener(current);
  }

  function assertAlive(): void {
    if (destroyed) throw new Error(`Note authority for ${noteId} has been destroyed.`);
  }

  function apply(tr: Transaction): DispatchResult {
    const applied = handle.apply(tr);
    const changed = applied.transactions.some((each) => each.docChanged);
    if (!changed) return { rev, changed: false };

    rev += 1;
    // An edit during a save must not overwrite `saving`. The save's completion
    // notices the newer revision and lands on `dirty` itself; clobbering the
    // state here would leave a save in flight that nothing is tracking.
    if (saveState !== 'saving') saveState = 'dirty';
    notify();
    return { rev, changed: true };
  }

  const access: AuthorityAccess = {
    get state() {
      return handle.state;
    },
    snapshot,
    apply,
  };

  return {
    noteId,
    snapshot,

    // These are `async` so that a call on a destroyed authority rejects rather
    // than throwing synchronously. A promise-returning function with two
    // failure modes makes every caller write two error paths.
    async dispatch(tr: Transaction): Promise<DispatchResult> {
      assertAlive();
      return queue.run(() => apply(tr));
    },

    dispatchLocal(tr: Transaction): DispatchResult {
      assertAlive();
      return apply(tr);
    },

    async run<T>(command: (access: AuthorityAccess) => T | Promise<T>): Promise<T> {
      assertAlive();
      return queue.run(() => command(access));
    },

    /**
     * Saves, in three parts: take the snapshot under the queue, do the round
     * trip *outside* it, then account for the result under the queue again.
     *
     * Holding the queue across the network call would be simpler and would
     * block typing for as long as the server took. Releasing it is what makes
     * the late-acknowledgement rule necessary rather than theoretical: edits
     * genuinely can land while a save is in flight, so the result is compared
     * against the revision it was taken at, never against the current one.
     */
    async save(persist: Persist): Promise<SaveResult> {
      assertAlive();

      const started = await queue.run(() => {
        if (saveState === 'saving') return null;
        if (rev <= savedRev) return null;
        saveState = 'saving';
        notify();
        return { snapshot: snapshot(), rev };
      });

      if (!started) return { status: 'skipped' };

      let outcome: CommitOutcome;
      try {
        outcome = await persist(started.snapshot);
      } catch (error) {
        outcome = { status: 'failed', error };
      }

      return queue.run((): SaveResult => {
        if (outcome.status === 'failed') {
          saveState = 'save_failed';
          notify();
          return { status: 'failed', error: outcome.error };
        }

        if (outcome.status === 'conflict') {
          // The document stays exactly as it is, and stays dirty. Rebasing onto
          // the reported version is the caller's decision, not something to do
          // silently underneath an editor someone is typing into.
          ver = outcome.ver;
          saveState = 'version_conflict';
          notify();
          return { status: 'conflict', ver };
        }

        ver = outcome.ver;
        // The revision that was *sent*, not the current one. Anything typed
        // during the round trip was never persisted, so counting it as saved
        // would drop it. Two saves cannot overlap — the `saving` check above is
        // what guarantees that — so this can only ever move forward.
        savedRev = started.rev;
        const stillDirty = rev > savedRev;
        saveState = stillDirty ? 'dirty' : 'saved';
        notify();
        return { status: 'saved', ver, stillDirty };
      });
    },

    subscribe(listener: (snapshot: NoteSnapshot) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    drain(): Promise<void> {
      return queue.drain();
    },

    destroy(): void {
      destroyed = true;
      // Not observable — nothing can dispatch after this, so nothing notifies.
      // It is here to drop the references: a listener is usually a closure over
      // a component, and an app that switches between thousands of notes would
      // otherwise retain one graph per note it ever opened.
      listeners.clear();
      handle.destroy();
    },
  };
}
