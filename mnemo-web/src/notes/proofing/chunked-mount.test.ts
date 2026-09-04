// @vitest-environment jsdom

/**
 * Proofing against a note that mounts in chunks.
 *
 * The editor handle's `state` getter finishes the load before it answers, which
 * appends every outstanding block in one transaction. So anything that
 * enumerates blocks through the handle collapses the chunked mount on the frame
 * the note opens, which is the freeze chunking exists to avoid. Proofing reads
 * `view.state` for exactly that reason, and this is the regression guard for
 * it: after the scheduler has run, the view still holds the first chunk alone.
 *
 * The second case is the other half of the same hazard. Once something does
 * drain the load, three thousand blocks arrive in a single transaction, and the
 * request count on that frame has to stay bounded.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { buildNoteEditState } from '../edit/build-edit-state';
import { mountEditor } from '../editor/view/mount';
import { blockOf, text } from './fixtures';
import { subscribeProofing } from './proofing-plugin';
import { createProofingScheduler, type ProofingSchedule } from './scheduler';
import type { ProofingCheckRequest, ProofingCheckResponse } from './types';
import type { ProofingClient } from './client';

const FIRST_CHUNK = 5;

afterEach(() => {
  document.body.replaceChildren();
});

function manualSchedule() {
  const queue: (() => void)[] = [];
  const schedule: ProofingSchedule = (run) => {
    queue.push(run);
    return () => {
      const at = queue.indexOf(run);
      if (at >= 0) queue.splice(at, 1);
    };
  };
  return { schedule, pending: () => queue.length, run: () => queue.shift()?.() };
}

function stubClient(requests: ProofingCheckRequest[]) {
  return {
    check(request: ProofingCheckRequest): Promise<ProofingCheckResponse> {
      requests.push(request);
      return Promise.resolve({
        languages: request.languages,
        paragraphs: request.paragraphs.map((paragraph) => ({ id: paragraph.id, issues: [] })),
      });
    },
  } as unknown as ProofingClient;
}

function mountLargeNote() {
  const blocks = Array.from({ length: 60 }, (_unused, index) =>
    blockOf({ sid: `s${String(index).padStart(4, '0')}`, spans: [text(`paragraph ${String(index)}`)] }),
  );
  const built = buildNoteEditState(blocks);
  if (!built.ok) throw new Error('quarantined');

  const mount = document.createElement('div');
  document.body.appendChild(mount);

  const mounted = mountEditor({
    mount,
    state: built.state,
    registry: built.registry,
    chunkThreshold: 10,
    firstChunkSize: FIRST_CHUNK,
    chunkSize: 20,
    // Never runs, so the background load stays exactly where it started and any
    // drain visible below can only have come from proofing.
    schedule: () => undefined,
  });

  return { mounted, registry: built.registry };
}

describe('proofing over a chunked mount', () => {
  it('leaves the load where it found it', async () => {
    const { mounted, registry } = mountLargeNote();
    const clock = manualSchedule();
    const requests: ProofingCheckRequest[] = [];

    expect(mounted.view.state.doc.childCount).toBe(FIRST_CHUNK);

    const scheduler = createProofingScheduler({
      view: mounted.view,
      registry,
      noteId: 'note',
      languages: ['en-US'],
      client: stubClient(requests),
      schedule: clock.schedule,
    });

    scheduler.start();
    while (clock.pending() > 0) {
      clock.run();
      await Promise.resolve();
      await Promise.resolve();
    }

    expect(mounted.view.state.doc.childCount).toBe(FIRST_CHUNK);
    expect(requests).toHaveLength(1);
    expect(requests[0].paragraphs).toHaveLength(FIRST_CHUNK);

    scheduler.destroy();
    mounted.destroy();
  });

  it('answers a drained load with one request on the frame it lands', async () => {
    const { mounted, registry } = mountLargeNote();
    const clock = manualSchedule();
    const requests: ProofingCheckRequest[] = [];

    const scheduler = createProofingScheduler({
      view: mounted.view,
      registry,
      noteId: 'note',
      languages: ['en-US'],
      client: stubClient(requests),
      schedule: clock.schedule,
      debounceMs: 0,
    });
    const unsubscribe = subscribeProofing(mounted.view, (_state, docChanged) => {
      if (docChanged) scheduler.noteEdit();
    });

    // Reading the handle is what a careless consumer does, and it appends every
    // remaining block in one transaction.
    expect(mounted.handle.state.doc.childCount).toBe(60);
    expect(mounted.view.state.doc.childCount).toBe(60);

    await new Promise((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();

    expect(requests.length).toBeLessThanOrEqual(1);
    for (const request of requests) expect(request.paragraphs.length).toBeLessThanOrEqual(50);

    unsubscribe();
    scheduler.destroy();
    mounted.destroy();
  });

  it('gives the hook no way to reach the handle in the first place', () => {
    // Read from disk rather than imported: the point is what the file may not
    // contain, which no amount of exercising it can show.
    const source = readFileSync(path.join(process.cwd(), 'src/notes/proofing/useProofing.ts'), 'utf8');
    expect(source).toMatch(/view: EditorView \| null/);
    expect(source).not.toMatch(/EditorHandle|handle\.state|session\.state/);
  });
});
