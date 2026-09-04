// @vitest-environment jsdom

/**
 * What happens to a mark after the segment that owns it stops existing.
 *
 * A decoration maps forward on its own and knows nothing about the block it
 * described. Only an answer takes marks back, and an answer only ever names a
 * segment that is still checkable, so a segment that leaves the set strands its
 * underline over whatever the text became. All three routes below are ordinary
 * editing, and all three are driven here through the real commands, the real
 * view and the real scheduler.
 */

import { TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { afterEach, describe, expect, it } from 'vitest';

import { buildNoteEditState } from '../edit/build-edit-state';
import { deleteCrossBlockRange } from '../editor/commands/range-delete';
import { convertBlockType } from '../editor/commands/structure';
import { toggleFormat } from '../editor/marks/commands';
import { blockOf, registry, text } from './fixtures';
import { getProofingState, proofingIssues } from './proofing-plugin';
import { createProofingScheduler, type ProofingSchedule } from './scheduler';
import { checkableSegments } from './segments';
import type { ProofingCheckRequest, ProofingCheckResponse } from './types';
import type { ProofingClient } from './client';

afterEach(() => {
  document.body.replaceChildren();
});

/** Flags the first word of every segment it is asked about. */
function stubClient(requests: ProofingCheckRequest[]) {
  return {
    check(request: ProofingCheckRequest): Promise<ProofingCheckResponse> {
      requests.push(request);
      return Promise.resolve({
        language: request.language,
        paragraphs: request.paragraphs.map((paragraph) => {
          const word = /\p{L}+/u.exec(paragraph.text);
          return {
            id: paragraph.id,
            issues: word
              ? [
                  {
                    start: word.index,
                    end: word.index + word[0].length,
                    text: word[0],
                    kind: 'spelling',
                    tone: 'error' as const,
                  },
                ]
              : [],
          };
        }),
      });
    },
  } as unknown as ProofingClient;
}

function harness(...paragraphs: string[]) {
  const built = buildNoteEditState(
    paragraphs.map((value, index) => blockOf({ sid: `s${String(index)}`, spans: [text(value)] })),
  );
  if (!built.ok) throw new Error('quarantined');

  const mount = document.createElement('div');
  document.body.appendChild(mount);
  const view = new EditorView(mount, { state: built.state });

  const queue: (() => void)[] = [];
  const schedule: ProofingSchedule = (run) => {
    queue.push(run);
    return () => {
      const at = queue.indexOf(run);
      if (at >= 0) queue.splice(at, 1);
    };
  };

  const requests: ProofingCheckRequest[] = [];
  const scheduler = createProofingScheduler({
    view,
    registry,
    noteId: 'note',
    language: 'en-US',
    client: stubClient(requests),
    schedule,
    batchSize: 50,
  });

  async function pass(): Promise<void> {
    scheduler.start();
    while (queue.length > 0) {
      queue.shift()?.();
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    }
  }

  return {
    view,
    requests,
    pass,
    liveIds: () => new Set(checkableSegments(view.state.doc, registry).map((segment) => segment.id)),
    destroy() {
      scheduler.destroy();
      view.destroy();
    },
  };
}

/** No mark may name a segment the document no longer has, and the count must agree. */
function assertNoOrphans(h: ReturnType<typeof harness>): void {
  const live = h.liveIds();
  const marks = proofingIssues(h.view.state);
  expect(marks.map((located) => located.issue.segmentId).filter((id) => !live.has(id))).toEqual([]);
  expect(getProofingState(h.view.state).count).toBe(marks.length);
}

describe('a mark whose segment stops existing', () => {
  it('is taken back when a range delete merges its block away', async () => {
    const h = harness('teh cat', 'recieve it');
    await h.pass();
    expect(proofingIssues(h.view.state)).toHaveLength(2);
    const before = getProofingState(h.view.state).count;

    // From inside the first flagged word to inside the second, which is the
    // shape range-delete owns: the tail block is merged away and its short id
    // with it.
    const first = proofingIssues(h.view.state)[0];
    const second = proofingIssues(h.view.state)[1];
    h.view.dispatch(
      h.view.state.tr.setSelection(
        TextSelection.create(h.view.state.doc, first.from + 1, second.from + 3),
      ),
    );
    expect(deleteCrossBlockRange(h.view.state, h.view.dispatch)).toBe(true);
    await h.pass();

    assertNoOrphans(h);
    expect(getProofingState(h.view.state).count).toBeLessThan(before);
    h.destroy();
  });

  it('is taken back when the whole line becomes inline code', async () => {
    const h = harness('teh cat', 'other words');
    await h.pass();
    const before = getProofingState(h.view.state).count;

    // The natural answer to a false positive: mark the token as code. That
    // blanks the segment, so nothing will ever ask about it again.
    const line = h.view.state.doc.child(0);
    const from = 2;
    h.view.dispatch(
      h.view.state.tr.setSelection(TextSelection.create(h.view.state.doc, from, from + line.textContent.length)),
    );
    expect(toggleFormat('code')(h.view.state, h.view.dispatch)).toBe(true);
    await h.pass();

    expect(h.liveIds().has('s0:0')).toBe(false);
    assertNoOrphans(h);
    expect(getProofingState(h.view.state).count).toBeLessThan(before);
    h.destroy();
  });

  it('is taken back when the paragraph becomes a block equation', async () => {
    const h = harness('teh cat');
    await h.pass();
    expect(proofingIssues(h.view.state)).toHaveLength(1);

    // The line content survives the conversion, so the decoration maps through,
    // but the segment is attribute backed and leaves the checkable set.
    const node = h.view.state.doc.child(0);
    h.view.dispatch(
      convertBlockType(h.view.state.tr, 0, node, h.view.state.schema.nodes.equationBlock),
    );
    await h.pass();

    assertNoOrphans(h);
    expect(proofingIssues(h.view.state)).toHaveLength(0);
    expect(getProofingState(h.view.state).count).toBe(0);
    h.destroy();
  });
});
