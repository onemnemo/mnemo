/**
 * A serialized command queue: one command at a time, in the order they arrived.
 *
 * The authority needs this because its commands are not all synchronous. A save
 * is a network round trip, and without serialization a second save could read
 * the same base version as the first and both would think they were the writer.
 * Ordering matters as much as exclusion: two edits that arrive in one tick have
 * to land in that order, or the document depends on promise scheduling.
 *
 * **Commands must not re-enter the queue.** A command that calls `run` from
 * inside itself waits on a chain it is already holding, and deadlocks. There is
 * no runtime guard for this, because a re-entrant call is indistinguishable
 * from an unrelated caller enqueuing during an await. It is designed out
 * instead: the authority builds its commands from unqueued primitives, so
 * nothing inside a command has a queued call to reach for.
 */

export interface CommandQueue {
  /**
   * Enqueues a command. It runs once everything before it has settled, and
   * resolves or rejects with whatever the command did.
   */
  run<T>(command: () => T | Promise<T>): Promise<T>;

  /** Commands queued or running. Zero means idle. */
  readonly depth: number;

  /** Resolves once everything queued *at the time of the call* has settled. */
  drain(): Promise<void>;
}

export function createCommandQueue(): CommandQueue {
  let tail: Promise<unknown> = Promise.resolve();
  let depth = 0;

  function settled(): void {
    depth -= 1;
  }

  return {
    get depth() {
      return depth;
    },

    run<T>(command: () => T | Promise<T>): Promise<T> {
      depth += 1;
      const result = tail.then(command);
      // The chain absorbs failures on both paths, so one rejected command does
      // not wedge everything queued behind it. The rejection still reaches the
      // caller, through `result`.
      tail = result.then(settled, settled);
      return result;
    },

    drain(): Promise<void> {
      return tail.then(() => undefined);
    },
  };
}
