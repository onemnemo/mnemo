/**
 * A whole note, checked once.
 *
 * Six hundred blocks with deterministic text, so the numbers below are facts
 * about the scheduler rather than about the machine: how many requests a full
 * pass costs, how big each one is, and what a single keystroke costs once the
 * pass is done. The last of those is the one that decides whether the feature
 * is usable in a long note, and it is the one an innocent-looking change to
 * the cache key silently breaks.
 *
 * The second case counts document walks rather than milliseconds. Placing an
 * answer used to convert every flagged word with a walk from the start of the
 * document, projecting every block it passed, so a note where most words are
 * flagged cost O(issues x blocks) and froze for over a second on one tick. A
 * count is the honest measurement here: it is the same number on every machine
 * and it says exactly which shape the code has.
 */

import { EditorState, type Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { blockOf, docOf, registry, schema, text } from './fixtures';
import { checkableSegments } from './segments';
import { getProofingState, proofingIssues, proofingPlugin } from './proofing-plugin';
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
          languages: request.languages,
          paragraphs: request.paragraphs.map((paragraph) => ({ id: paragraph.id, issues: [] })),
        });
      },
    } as unknown as ProofingClient;

    const scheduler = createProofingScheduler({
      view,
      registry,
      noteId: 'note',
      languages: ['en-US'],
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

/** Counts the projection calls every block module makes, until it is restored. */
function countProjection() {
  const counts = { plainText: 0, positionOf: 0 };
  const restores: (() => void)[] = [];

  for (const module of registry.modules) {
    const project = module.project;
    const plainText = project.plainText.bind(project);
    const positionOf = project.positionOf.bind(project);
    project.plainText = (node) => {
      counts.plainText += 1;
      return plainText(node);
    };
    project.positionOf = (node, offset) => {
      counts.positionOf += 1;
      return positionOf(node, offset);
    };
    restores.push(() => {
      project.plainText = plainText;
      project.positionOf = positionOf;
    });
  }

  return {
    counts,
    restore: () => {
      for (const restore of restores) restore();
    },
  };
}

describe('what placing an answer costs', () => {
  it('never walks the document again once the note has been segmented', async () => {
    const blocks = 300;
    let state = EditorState.create({
      schema,
      doc: docOf(
        Array.from({ length: blocks }, (_unused, index) =>
          blockOf({
            sid: `s${String(index).padStart(4, '0')}`,
            spans: [text('alpha beta gamma delta epsilon')],
          }),
        ),
      ),
      plugins: [proofingPlugin()],
    });

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

    // Every word of every block flagged, which is what an English dictionary
    // does to a note written in a language nothing installed covers.
    const client = {
      check(request: ProofingCheckRequest): Promise<ProofingCheckResponse> {
        return Promise.resolve({
          languages: request.languages,
          paragraphs: request.paragraphs.map((paragraph) => ({
            id: paragraph.id,
            issues: [...paragraph.text.matchAll(/\p{L}+/gu)].map((match) => ({
              start: match.index,
              end: match.index + match[0].length,
              text: match[0],
              kind: 'spelling',
              tone: 'error' as const,
            })),
          })),
        });
      },
    } as unknown as ProofingClient;

    // Warm the segmentation, which is the one walk this is allowed to pay.
    expect(checkableSegments(state.doc, registry)).toHaveLength(blocks);

    const meter = countProjection();
    const scheduler = createProofingScheduler({
      view,
      registry,
      noteId: 'note',
      languages: ['en-US'],
      client,
      schedule,
      batchSize: BATCH,
    });

    scheduler.start();
    while (queue.length > 0) {
      queue.shift()?.();
      for (let i = 0; i < 4; i += 1) await Promise.resolve();
    }
    meter.restore();

    const placed = proofingIssues(state).length;
    expect(getProofingState(state).paused).toBe(false);
    expect(placed).toBe(blocks * 5);

    // The proof of correct output: every mark covers the word it was reported
    // for, so this is not a pass that placed nothing and won on cost.
    for (const located of proofingIssues(state)) {
      expect(state.doc.textBetween(located.from, located.to)).toBe(located.issue.text);
    }

    // Zero, not "fewer": a walk from the document start is what the old shape
    // did, and one call would mean it had come back.
    expect(meter.counts.plainText).toBe(0);
    // Two crossings per issue, the range's own ends, and nothing per block.
    expect(meter.counts.positionOf).toBe(placed * 2);

    scheduler.destroy();
  });
});
