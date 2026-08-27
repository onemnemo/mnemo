/**
 * Autosave: the policy that decides *when* a note is written.
 *
 * The authority already owns what a save is (take a snapshot, commit it,
 * account for the answer) and refuses to run two at once. Everything left is
 * timing, and timing is the whole difficulty: save on every keystroke and a long
 * note is a write storm; wait for a pause and someone who types without pausing
 * never gets saved at all.
 *
 * So there are two clocks, not one. A quiet period after the last edit, and a
 * ceiling on how long the *oldest* unsaved change may sit. Whichever comes
 * first wins. Under normal typing the quiet period fires; under a sustained run
 * of edits the ceiling does, at a steady cadence, which is exactly the case a
 * plain debounce loses work in.
 *
 * ## What it does with each answer
 *
 * - **saved**: start over. Anything typed during the round trip is still dirty
 *   and gets its own quiet period rather than an immediate second write.
 * - **failed**: retry on a widening backoff, then stop and stay stopped until
 *   the document changes again. Retrying a broken connection forever burns
 *   battery and tells the user nothing new; the next keystroke is a much better
 *   signal that conditions may have changed.
 * - **conflict**: stop, permanently. This is the one answer autosave must not
 *   act on. The authority adopts the version the server reported, so simply
 *   trying again *would succeed*, and would overwrite whatever the other
 *   writer put there with a document that never saw it. Rebasing is a decision
 *   with a person in it.
 */

import type { NoteAuthority, Persist, SaveResult } from '../authority/authority';

/**
 * The scheduler's view of time, injected so tests need neither real delays nor
 * fake timers patched over the global.
 */
export interface Clock {
  /** Runs `fn` after `ms`. The returned function cancels it. */
  schedule(fn: () => void, ms: number): () => void;
  /** Monotonic-enough milliseconds; only differences are ever used. */
  now(): number;
}

export const systemClock: Clock = {
  schedule(fn, ms) {
    const handle = setTimeout(fn, ms);
    return () => {
      clearTimeout(handle);
    };
  },
  now: () => Date.now(),
};

export interface AutosaveOptions {
  readonly authority: NoteAuthority;
  readonly persist: Persist;
  /** Quiet period after the last edit. */
  readonly debounceMs?: number;
  /** Longest the oldest unsaved change may wait while editing continues. */
  readonly maxWaitMs?: number;
  /** Backoff between retries of a failed save; its length is the retry count. */
  readonly retryDelaysMs?: readonly number[];
  /**
   * Whether editing schedules a write. Off means "do not write while I type",
   * and only that: `flush` and `destroy` ignore it, so closing a note still
   * saves. A function is read at each decision rather than captured here.
   */
  readonly enabled?: boolean | (() => boolean);
  readonly clock?: Clock;
  /** Every save outcome, in order. For tests and telemetry; the UI reads `saveState`. */
  onResult?(result: SaveResult): void;
}

export interface Autosave {
  /**
   * Saves now if there is anything to save, and resolves once it has settled.
   *
   * For the moments with no later chance: unmount, note switch, window close.
   * It does not retry, the caller is on its way out, and the outcome comes back
   * so it can say so.
   */
  flush(): Promise<SaveResult>;
  /** Stops scheduling. Does not save; `flush` first if that is wanted. */
  destroy(): void;
}

const defaultRetryDelaysMs = [1_000, 3_000, 10_000] as const;

export function startAutosave(options: AutosaveOptions): Autosave {
  const { authority, persist } = options;
  const debounceMs = options.debounceMs ?? 800;
  const maxWaitMs = options.maxWaitMs ?? 5_000;
  const retryDelaysMs = options.retryDelaysMs ?? defaultRetryDelaysMs;
  const clock = options.clock ?? systemClock;
  const enabled = options.enabled ?? true;
  const isEnabled = typeof enabled === 'function' ? enabled : () => enabled;

  let cancelTimer: (() => void) | null = null;
  /** When the oldest currently-unsaved change arrived. */
  let dirtySince: number | null = null;
  /** The save in flight, so `flush` can wait for it rather than race it. */
  let current: Promise<SaveResult> | null = null;
  let failures = 0;
  /**
   * The revision retries were given up on. Held rather than a plain flag so the
   * next real edit resumes: a changed document is the best evidence available
   * that whatever broke may not still be broken.
   */
  let exhaustedAt: number | null = null;
  /** Set by a version conflict, and never cleared. Only a reload resolves that. */
  let conflicted = false;
  let destroyed = false;

  function cancel(): void {
    cancelTimer?.();
    cancelTimer = null;
  }

  function schedule(delayMs: number): void {
    cancel();
    cancelTimer = clock.schedule(() => {
      cancelTimer = null;
      // Read again here and not only in `consider`, because the setting can be
      // turned off after a timer is already armed, and a retry arms one with no
      // edit behind it. Guarding `run` instead would stop `flush` and `destroy`
      // too. Left in the state `consider` would leave, so turning it back on
      // starts a clean quiet period rather than resuming an expired ceiling.
      if (!isEnabled()) {
        dirtySince = null;
        return;
      }
      void run();
    }, Math.max(0, delayMs));
  }

  /** Decides what, if anything, should be waiting to happen. */
  function consider(): void {
    if (destroyed || conflicted || current) return;

    // Read through on every decision rather than captured at construction, so
    // the scheduler can never act on an answer the settings store has replaced.
    if (!isEnabled()) {
      cancel();
      dirtySince = null;
      return;
    }

    // `status`, not `snapshot`: nothing here reads the document, and asking for
    // one is what would force a chunked mount to finish loading before the
    // first background frame ever runs.
    const status = authority.status();
    if (!status.dirty) {
      cancel();
      dirtySince = null;
      failures = 0;
      exhaustedAt = null;
      return;
    }

    if (exhaustedAt !== null) {
      if (status.rev === exhaustedAt) return;
      exhaustedAt = null;
      failures = 0;
    }

    dirtySince ??= clock.now();
    // Rescheduled from scratch on every edit, so the quiet period really is
    // measured from the *last* one, but never past the ceiling, which is
    // anchored to the first.
    schedule(Math.min(debounceMs, dirtySince + maxWaitMs - clock.now()));
  }

  function run(): Promise<SaveResult> {
    if (destroyed) return Promise.resolve({ status: 'skipped' });
    const attempt = authority
      .save(persist)
      // The authority rejects only when it has been destroyed underneath us,
      // which a pending timer can genuinely still reach.
      .catch((error: unknown): SaveResult => ({ status: 'failed', error }))
      .then((result) => {
        current = null;
        options.onResult?.(result);
        settle(result);
        return result;
      });
    current = attempt;
    return attempt;
  }

  function settle(result: SaveResult): void {
    if (destroyed) return;

    switch (result.status) {
      case 'conflict':
        conflicted = true;
        cancel();
        return;

      case 'failed': {
        const delay = retryDelaysMs[failures];
        failures += 1;
        if (delay === undefined) {
          exhaustedAt = authority.status().rev;
          cancel();
          return;
        }
        schedule(delay);
        return;
      }

      case 'saved':
      case 'skipped':
        failures = 0;
        exhaustedAt = null;
        // Deliberately not carried over from before the save: whatever was
        // typed during the round trip is a new change and gets its own quiet
        // period, rather than inheriting a ceiling that has already expired and
        // firing a second write immediately.
        dirtySince = null;
        consider();
    }
  }

  const unsubscribe = authority.subscribe(() => {
    consider();
  });
  consider();

  return {
    async flush(): Promise<SaveResult> {
      cancel();
      // A save already in flight holds the only chance to write what it
      // snapshotted; starting a second one just answers `skipped`. Wait it out,
      // then write anything it did not cover.
      if (current) await current;
      // That save's own accounting may have queued a retry while we waited.
      cancel();
      if (destroyed) return { status: 'skipped' };
      // Urgency must not overwrite unseen server changes. Return conflicted so exit callers can
      // distinguish failure from an empty flush.
      if (conflicted) return { status: 'conflict', ver: authority.status().ver };
      if (!authority.status().dirty) return { status: 'skipped' };
      return run();
    },

    destroy(): void {
      destroyed = true;
      cancel();
      unsubscribe();
    },
  };
}
