/**
 * The pacing rules, with the clock and the network both held still.
 *
 * Every one of these is a failure that only shows up on a real note: a request
 * per block on the frame a chunked mount lands, a check for every keystroke, an
 * answer about text the user has already replaced, or a note switch that paints
 * one note's mistakes onto another.
 */

import { EditorState, type Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { blockOf, docOf, registry, schema, text } from './fixtures';
import {
  MAX_ISSUES_PER_NOTE,
  getProofingState,
  proofingIssues,
  proofingPlugin,
} from './proofing-plugin';
import { createProofingScheduler, type ProofingSchedule } from './scheduler';
import type { ProofingCheckRequest, ProofingCheckResponse } from './types';
import type { ProofingClient } from './client';

function stateOf(values: readonly string[]): EditorState {
  return EditorState.create({
    schema,
    doc: docOf(values.map((value, index) => blockOf({ sid: `s${String(index)}`, spans: [text(value)] }))),
    plugins: [proofingPlugin()],
  });
}

function fakeView(initial: EditorState) {
  let state = initial;
  const view = {
    get state() {
      return state;
    },
    dispatch(tr: Transaction) {
      state = state.apply(tr);
    },
    isDestroyed: false,
  };
  return {
    view: view as unknown as EditorView,
    current: () => state,
    edit: (apply: (tr: Transaction) => Transaction) => {
      state = state.apply(apply(state.tr));
    },
  };
}

/** A queue of deferred work the test drains by hand. */
function manualSchedule() {
  const queue: (() => void)[] = [];
  const schedule: ProofingSchedule = (run) => {
    queue.push(run);
    return () => {
      const at = queue.indexOf(run);
      if (at >= 0) queue.splice(at, 1);
    };
  };
  return {
    schedule,
    pending: () => queue.length,
    run: () => {
      const next = queue.shift();
      next?.();
    },
  };
}

type CheckHandler = (request: ProofingCheckRequest) => Promise<ProofingCheckResponse>;

/** Flags the first word of every paragraph it is asked about. */
const flagFirstWord: CheckHandler = (request) =>
  Promise.resolve({
    languages: request.languages,
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

/** Flags exactly the words in `set`, wherever they appear. */
function flagWords(set: ReadonlySet<string>): CheckHandler {
  return (request) =>
    Promise.resolve({
      languages: request.languages,
      paragraphs: request.paragraphs.map((paragraph) => ({
        id: paragraph.id,
        issues: [...paragraph.text.matchAll(/\p{L}[\p{L}\d]*/gu)]
          .filter((match) => set.has(match[0]))
          .map((match) => ({
            start: match.index,
            end: match.index + match[0].length,
            text: match[0],
            kind: 'spelling',
            tone: 'error' as const,
          })),
      })),
    });
}

/** Flags every word, the way an English dictionary reads a German note. */
const flagEveryWord: CheckHandler = (request) =>
  Promise.resolve({
    languages: request.languages,
    paragraphs: request.paragraphs.map((paragraph) => ({
      id: paragraph.id,
      issues: [...paragraph.text.matchAll(/\p{L}[\p{L}\d]*/gu)].map((match) => ({
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
        kind: 'spelling',
        tone: 'error' as const,
      })),
    })),
  });

function stubClient(handler: CheckHandler) {
  const requests: ProofingCheckRequest[] = [];
  const client = {
    check(request: ProofingCheckRequest) {
      requests.push(request);
      return handler(request);
    },
  } as unknown as ProofingClient;
  return { client, requests };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the proofing scheduler', () => {
  it('sends one batch per scheduled tick, never a request per block', async () => {
    const host = fakeView(stateOf(Array.from({ length: 120 }, (_unused, i) => `block ${String(i)} teh`)));
    const clock = manualSchedule();
    const { client, requests } = stubClient(flagFirstWord);

    const scheduler = createProofingScheduler({
      view: host.view,
      registry,
      noteId: 'note',
      languages: ['en-US'],
      client,
      schedule: clock.schedule,
      batchSize: 50,
    });

    scheduler.start();
    expect(requests).toHaveLength(0);

    clock.run();
    expect(requests).toHaveLength(1);
    expect(requests[0].paragraphs).toHaveLength(50);

    await flush();
    clock.run();
    await flush();
    clock.run();
    await flush();

    expect(requests.map((request) => request.paragraphs.length)).toEqual([50, 50, 20]);
    expect(proofingIssues(host.current())).toHaveLength(120);
    scheduler.destroy();
  });

  it('waits out a run of keystrokes and then asks about the one segment that changed', async () => {
    const host = fakeView(stateOf(['alpha teh', 'beta recieve']));
    const clock = manualSchedule();
    const { client, requests } = stubClient(flagFirstWord);

    const scheduler = createProofingScheduler({
      view: host.view,
      registry,
      noteId: 'note',
      languages: ['en-US'],
      client,
      schedule: clock.schedule,
    });

    scheduler.start();
    clock.run();
    await flush();
    expect(requests).toHaveLength(1);

    // Four keystrokes inside 400 ms are one check, not four.
    for (let i = 0; i < 4; i += 1) {
      host.edit((tr) => tr.insertText('x', 3));
      scheduler.noteEdit();
      await vi.advanceTimersByTimeAsync(50);
    }
    expect(requests).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(400);
    await flush();

    expect(requests).toHaveLength(2);
    expect(requests[1].paragraphs).toHaveLength(1);
    expect(requests[1].paragraphs[0].text).toContain('xxxx');
  });

  it('drops an answer about text the user has already replaced', async () => {
    const host = fakeView(stateOf(['alpha teh']));
    const clock = manualSchedule();
    // A holder rather than a bare `let`, so the assignment inside the promise
    // executor is visible to the reader below it.
    const gate: { release?: () => void } = {};
    const { client, requests } = stubClient(
      (request) =>
        new Promise<ProofingCheckResponse>((resolve) => {
          gate.release = () => void flagFirstWord(request).then(resolve);
        }),
    );

    const scheduler = createProofingScheduler({
      view: host.view,
      registry,
      noteId: 'note',
      languages: ['en-US'],
      client,
      schedule: clock.schedule,
    });

    scheduler.start();
    clock.run();
    expect(requests).toHaveLength(1);

    host.edit((tr) => tr.insertText('rewritten ', 3));
    // Without this the case could pass because the edit never reached the text.
    expect(host.current().doc.textContent).toContain('rewritten');
    gate.release?.();
    await flush();

    expect(proofingIssues(host.current())).toHaveLength(0);
    scheduler.destroy();
  });

  it('drops an answer over languages that are no longer the ones being checked', async () => {
    const host = fakeView(stateOf(['alpha teh']));
    const clock = manualSchedule();
    const { client } = stubClient((request) =>
      flagFirstWord(request).then((answer) => ({ ...answer, languages: ['de-DE'] })),
    );

    const scheduler = createProofingScheduler({
      view: host.view,
      registry,
      noteId: 'note',
      languages: ['en-US'],
      client,
      schedule: clock.schedule,
    });

    scheduler.start();
    clock.run();
    await flush();

    expect(proofingIssues(host.current())).toHaveLength(0);
    scheduler.destroy();
  });

  it('files a mismatched answer rather than asking the same question again', async () => {
    // The failure this covers is not a dropped answer, it is a loop: a dropped
    // answer that leaves its batch unanswered puts the same batch back at the
    // head of the queue, and the host keeps answering the same way, so the
    // note spends the rest of the session re-asking about one batch.
    const host = fakeView(stateOf(['alpha teh', 'beta recieve', 'gamma seperate']));
    const clock = manualSchedule();
    const { client, requests } = stubClient((request) =>
      flagFirstWord(request).then((answer) => ({ ...answer, languages: ['en-US', 'es-ES'] })),
    );

    const scheduler = createProofingScheduler({
      view: host.view,
      registry,
      noteId: 'note',
      languages: ['en-US'],
      client,
      schedule: clock.schedule,
      batchSize: 1,
    });

    scheduler.start();
    // Bounded, because a scheduler that never settles would otherwise hang the
    // run rather than fail it.
    for (let attempt = 0; attempt < 50 && clock.pending() > 0; attempt += 1) {
      clock.run();
      await flush();
    }

    expect(clock.pending()).toBe(0);
    expect(requests).toHaveLength(3);
    expect(proofingIssues(host.current())).toHaveLength(0);
    scheduler.destroy();
  });

  it('applies nothing once it has been destroyed, which is what a note switch does', async () => {
    const host = fakeView(stateOf(['alpha teh']));
    const clock = manualSchedule();
    const gate: { release?: (answer: ProofingCheckResponse) => void } = {};
    const { client, requests } = stubClient(
      () =>
        new Promise<ProofingCheckResponse>((resolve) => {
          gate.release = resolve;
        }),
    );

    const scheduler = createProofingScheduler({
      view: host.view,
      registry,
      noteId: 'note-a',
      languages: ['en-US'],
      client,
      schedule: clock.schedule,
    });

    scheduler.start();
    clock.run();
    expect(requests).toHaveLength(1);

    scheduler.destroy();
    gate.release?.({
      languages: ['en-US'],
      paragraphs: [{ id: requests[0].paragraphs[0].id, issues: [{ start: 6, end: 9, text: 'teh', kind: 'spelling', tone: 'error' }] }],
    });
    await flush();

    expect(proofingIssues(host.current())).toHaveLength(0);
    expect(clock.pending()).toBe(0);
  });

  it('issues one set of requests across a double mount, not two', async () => {
    const host = fakeView(stateOf(['alpha teh']));
    const clock = manualSchedule();
    const { client, requests } = stubClient(flagFirstWord);
    const options = {
      view: host.view,
      registry,
      noteId: 'note',
      languages: ['en-US'],
      client,
      schedule: clock.schedule,
    };

    // What StrictMode does: mount, tear down, mount again, all before the first
    // idle callback gets to run.
    const first = createProofingScheduler(options);
    first.start();
    first.destroy();
    const second = createProofingScheduler(options);
    second.start();

    while (clock.pending() > 0) {
      clock.run();
      await flush();
    }

    expect(requests).toHaveLength(1);
    expect(proofingIssues(host.current())).toHaveLength(1);
    second.destroy();
  });

  it('leaves a segment unchecked while a dictionary is loading and retries exactly once', async () => {
    const host = fakeView(stateOf(['alpha teh']));
    const clock = manualSchedule();
    const loading = Object.assign(new Error('loading'), { status: 503 });
    const { client, requests } = stubClient(() => Promise.reject(loading));

    const scheduler = createProofingScheduler({
      view: host.view,
      registry,
      noteId: 'note',
      languages: ['en-US'],
      client,
      schedule: clock.schedule,
      retryMs: 2000,
    });

    scheduler.start();
    clock.run();
    await flush();
    expect(requests).toHaveLength(1);
    expect(proofingIssues(host.current())).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(2000);
    await flush();
    expect(requests).toHaveLength(2);

    // No third attempt on its own: the next edit is what wakes it again.
    await vi.advanceTimersByTimeAsync(10_000);
    await flush();
    expect(requests).toHaveLength(2);

    scheduler.noteEdit();
    await vi.advanceTimersByTimeAsync(400);
    await flush();
    expect(requests).toHaveLength(3);
    scheduler.destroy();
  });

  it('does not re-ask about a segment the answer left out', async () => {
    const host = fakeView(stateOf(['alpha teh', 'beta recieve']));
    const clock = manualSchedule();
    // Answers about the first paragraph only, which is what a host that drops
    // an empty result looks like from here.
    const { client, requests } = stubClient((request) =>
      flagFirstWord(request).then((answer) => ({ ...answer, paragraphs: answer.paragraphs.slice(0, 1) })),
    );

    const scheduler = createProofingScheduler({
      view: host.view,
      registry,
      noteId: 'note',
      languages: ['en-US'],
      client,
      schedule: clock.schedule,
    });

    scheduler.start();
    for (let i = 0; i < 4; i += 1) {
      clock.run();
      await flush();
    }

    expect(requests).toHaveLength(1);
    scheduler.destroy();
  });

  it('costs one batch when a batch is rejected, not the tail of the note', async () => {
    const host = fakeView(stateOf(Array.from({ length: 120 }, (_unused, i) => `block ${String(i)} teh`)));
    const clock = manualSchedule();
    const rejected = Object.assign(new Error('too large'), { status: 413 });
    // The middle batch is refused every time it is asked.
    const { client, requests } = stubClient((request) =>
      request.paragraphs[0].id === 's50:0' ? Promise.reject(rejected) : flagFirstWord(request),
    );

    const scheduler = createProofingScheduler({
      view: host.view,
      registry,
      noteId: 'note',
      languages: ['en-US'],
      client,
      schedule: clock.schedule,
      batchSize: 50,
    });

    scheduler.start();
    while (clock.pending() > 0) {
      clock.run();
      await flush();
    }

    // Three batches, the middle one asked twice: one retry, then it is retired
    // so the last twenty blocks still get checked.
    expect(requests.map((request) => request.paragraphs[0].id)).toEqual([
      's0:0',
      's50:0',
      's50:0',
      's100:0',
    ]);
    expect(proofingIssues(host.current()).map((located) => located.issue.segmentId)).toContain('s100:0');
    scheduler.destroy();
  });

  it('stops asking once the note holds as many marks as it may', async () => {
    // Forty flagged words in each of a hundred blocks: four thousand offered
    // against a cap of two thousand, which is the shape of a note written in a
    // language no installed dictionary covers.
    const words = Array.from({ length: 40 }, (_unused, i) => `w${String(i).padStart(3, '0')}`).join(' ');
    const host = fakeView(stateOf(Array.from({ length: 100 }, () => words)));
    const clock = manualSchedule();
    const { client, requests } = stubClient(flagEveryWord);

    const scheduler = createProofingScheduler({
      view: host.view,
      registry,
      noteId: 'note',
      languages: ['en-US'],
      client,
      schedule: clock.schedule,
      batchSize: 10,
    });

    scheduler.start();
    while (clock.pending() > 0) {
      clock.run();
      await flush();
    }

    expect(getProofingState(host.current()).paused).toBe(true);
    // Ten batches were available; it stopped as soon as there was nowhere left
    // to put an answer rather than asking for the rest of the note.
    expect(requests.length).toBeLessThan(10);
    expect(proofingIssues(host.current()).length).toBeLessThanOrEqual(MAX_ISSUES_PER_NOTE);
    scheduler.destroy();
  });

  it('asks about a segment once per text, however many ticks go by', async () => {
    const host = fakeView(stateOf(['alpha teh', 'beta recieve']));
    const clock = manualSchedule();
    const { client, requests } = stubClient(flagFirstWord);

    const scheduler = createProofingScheduler({
      view: host.view,
      registry,
      noteId: 'note',
      languages: ['en-US'],
      client,
      schedule: clock.schedule,
    });

    scheduler.start();
    while (clock.pending() > 0) {
      clock.run();
      await flush();
    }

    expect(requests).toHaveLength(1);
    scheduler.noteEdit();
    await vi.advanceTimersByTimeAsync(400);
    await flush();
    expect(requests).toHaveLength(1);
    scheduler.destroy();
  });

  it('re-marks a word a correction removed and an undo brought back', async () => {
    const host = fakeView(stateOf(['teh cat']));
    const clock = manualSchedule();
    const { client } = stubClient(flagWords(new Set(['teh'])));

    const scheduler = createProofingScheduler({
      view: host.view,
      registry,
      noteId: 'note',
      languages: ['en-US'],
      client,
      schedule: clock.schedule,
    });

    scheduler.start();
    clock.run();
    await flush();
    expect(proofingIssues(host.current())).toHaveLength(1);

    // The fix: "teh" -> "the". Its content goes, so its mark goes with it, and
    // the re-check finds the segment clean.
    host.edit((tr) => tr.replaceWith(2, 5, schema.text('the')));
    scheduler.noteEdit();
    await vi.advanceTimersByTimeAsync(400);
    await flush();
    expect(proofingIssues(host.current())).toHaveLength(0);

    // Undo brings the misspelling back. The word was flagged the first time, and
    // it is still a mistake, so the mark has to come back with it rather than the
    // note deciding it has already answered for this text and staying quiet.
    host.edit((tr) => tr.replaceWith(2, 5, schema.text('teh')));
    scheduler.noteEdit();
    await vi.advanceTimersByTimeAsync(400);
    await flush();
    expect(proofingIssues(host.current()).map((located) => located.issue.text)).toEqual(['teh']);
    scheduler.destroy();
  });

  it('answers a state it has already seen from memory, without the network', async () => {
    const host = fakeView(stateOf(['teh cat']));
    const clock = manualSchedule();
    const { client, requests } = stubClient(flagWords(new Set(['teh'])));

    const scheduler = createProofingScheduler({
      view: host.view,
      registry,
      noteId: 'note',
      languages: ['en-US'],
      client,
      schedule: clock.schedule,
    });

    scheduler.start();
    clock.run();
    await flush();

    // Correct, then undo. Two texts have been asked about: "teh cat" and
    // "the cat", so two requests, no more.
    host.edit((tr) => tr.replaceWith(2, 5, schema.text('the')));
    scheduler.noteEdit();
    await vi.advanceTimersByTimeAsync(400);
    await flush();

    host.edit((tr) => tr.replaceWith(2, 5, schema.text('teh')));
    scheduler.noteEdit();
    await vi.advanceTimersByTimeAsync(400);
    await flush();

    expect(requests).toHaveLength(2);
    expect(proofingIssues(host.current())).toHaveLength(1);
    scheduler.destroy();
  });
});
