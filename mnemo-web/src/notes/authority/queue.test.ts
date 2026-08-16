import { describe, expect, it } from 'vitest';

import { createCommandQueue } from './queue';

/** A promise plus the handles to settle it, so a test can hold a command open. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('command queue', () => {
  it('runs commands in the order they were enqueued', async () => {
    const queue = createCommandQueue();
    const order: number[] = [];

    // Deliberately slowest-first: if the queue awaited nothing, these would
    // finish in reverse.
    const delays = [30, 20, 10, 0];
    await Promise.all(
      delays.map((delay, index) =>
        queue.run(async () => {
          await new Promise((resolve) => setTimeout(resolve, delay));
          order.push(index);
        }),
      ),
    );

    expect(order).toEqual([0, 1, 2, 3]);
  });

  it('never runs two commands at once', async () => {
    const queue = createCommandQueue();
    let running = 0;
    let peak = 0;

    await Promise.all(
      Array.from({ length: 8 }, () =>
        queue.run(async () => {
          running += 1;
          peak = Math.max(peak, running);
          await Promise.resolve();
          running -= 1;
        }),
      ),
    );

    expect(peak).toBe(1);
  });

  it('keeps running after a command rejects', async () => {
    const queue = createCommandQueue();
    const ran: string[] = [];

    const failing = queue.run(() => {
      ran.push('first');
      throw new Error('boom');
    });
    const after = queue.run(() => {
      ran.push('second');
      return 'ok';
    });

    await expect(failing).rejects.toThrow('boom');
    await expect(after).resolves.toBe('ok');
    expect(ran).toEqual(['first', 'second']);
  });

  it('reports the rejection to the caller rather than swallowing it', async () => {
    const queue = createCommandQueue();
    await expect(queue.run(() => Promise.reject(new Error('nope')))).rejects.toThrow('nope');
  });

  it('resolves with the command result', async () => {
    const queue = createCommandQueue();
    await expect(queue.run(() => 42)).resolves.toBe(42);
    await expect(queue.run(() => Promise.resolve('async'))).resolves.toBe('async');
  });

  it('counts queued and running commands, and returns to idle', async () => {
    const queue = createCommandQueue();
    expect(queue.depth).toBe(0);

    const gate = deferred<void>();
    const first = queue.run(() => gate.promise);
    const second = queue.run(() => undefined);
    expect(queue.depth).toBe(2);

    gate.resolve();
    await Promise.all([first, second]);
    expect(queue.depth).toBe(0);
  });

  it('returns to idle even when a command rejected', async () => {
    const queue = createCommandQueue();
    await expect(queue.run(() => Promise.reject(new Error('x')))).rejects.toThrow();
    expect(queue.depth).toBe(0);
  });

  it('drains everything queued at the time of the call', async () => {
    const queue = createCommandQueue();
    const done: number[] = [];
    for (const index of [0, 1, 2]) queue.run(() => void done.push(index));

    await queue.drain();
    expect(done).toEqual([0, 1, 2]);
  });

  it('drain does not wait for commands queued after it', async () => {
    const queue = createCommandQueue();
    const gate = deferred<void>();
    const drained = queue.drain();

    // Enqueued after `drain` was called, and never settled. If drain waited for
    // it, this test would time out rather than fail.
    queue.run(() => gate.promise);

    await expect(drained).resolves.toBeUndefined();
    gate.resolve();
  });
});
