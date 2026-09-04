/**
 * A whole note, checked once.
 *
 * Six hundred blocks with deterministic text, so the numbers below are facts
 * about the scheduler rather than about the machine: how many requests a full
 * pass costs, how big each one is, and what a single keystroke costs once the
 * pass is done. The last of those is the one that decides whether the feature
 * is usable in a long note, and it is the one an innocent-looking change to
 * the cache key silently breaks.
 */

import { EditorState, type Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { blockOf, docOf, registry, schema, text } from './fixtures';
import { proofingPlugin } from './proofing-plugin';
import { createProofingScheduler, type ProofingSchedule } from './scheduler';
import type { ProofingCheckRequest, ProofingCheckResponse } from './types';
import type { ProofingClient } from './client';

const BLOCKS = 600;
const BATCH = 50;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function bigNote(): EditorState {
  return EditorState.create({
    schema,
    doc: docOf(
      Array.from({ length: BLOCKS }, (_unused, index) =>
        blockOf({
          sid: `s${String(index).padStart(4, '0')}`,
          spans: [text(`paragraph number ${String(index)} says something`)],
        }),
      ),
    ),
    plugins: [proofingPlugin()],
  });
}

describe('a full pass over a six hundred block note', () => {
  it('costs one request per batch, and one keystroke costs one segment', async () => {
    let state = bigNote();
    const view = {
      get state() {
        return state;
      },
      dispatch(tr: Transaction) {
        state = state.apply(tr);
      },
      isDestroyed: false,
    } as unknown as EditorView;

    const queue: (() => void)[] = [];
    const schedule: ProofingSchedule = (run) => {
      queue.push(run);
      return () => {
        const at = queue.indexOf(run);
        if (at >= 0) queue.splice(at, 1);
      };
    };

    const requests: ProofingCheckRequest[] = [];
    const client = {
      check(request: ProofingCheckRequest): Promise<ProofingCheckResponse> {
        requests.push(request);
        return Promise.resolve({
          language: request.language,
          paragraphs: request.paragraphs.map((paragraph) => ({ id: paragraph.id, issues: [] })),
        });
      },
    } as unknown as ProofingClient;

    const scheduler = createProofingScheduler({
      view,
      registry,
      noteId: 'note',
      language: 'en-US',
      client,
      schedule,
      batchSize: BATCH,
    });

    scheduler.start();
    while (queue.length > 0) {
      queue.shift()?.();
      for (let i = 0; i < 4; i += 1) await Promise.resolve();
    }

    expect(requests).toHaveLength(BLOCKS / BATCH);
    for (const request of requests) expect(request.paragraphs).toHaveLength(BATCH);
    expect(new Set(requests.flatMap((request) => request.paragraphs.map((p) => p.id))).size).toBe(BLOCKS);

    // One character typed into one paragraph. Everything else is unchanged and
    // already answered, so nothing else may be asked about again.
    const before = requests.length;
    state = state.apply(state.tr.insertText('x', 4));
    scheduler.noteEdit();
    await vi.advanceTimersByTimeAsync(400);
    for (let i = 0; i < 4; i += 1) await Promise.resolve();

    expect(requests).toHaveLength(before + 1);
    expect(requests[before].paragraphs).toHaveLength(1);
    expect(requests[before].paragraphs[0].id).toBe('s0000:0');

    scheduler.destroy();
  });
});
