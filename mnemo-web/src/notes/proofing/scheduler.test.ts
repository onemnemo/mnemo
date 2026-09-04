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
import { getProofingState, proofingPlugin } from './proofing-plugin';
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
      language: 'en-US',
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
    expect(getProofingState(host.current()).issues).toHaveLength(120);
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
      language: 'en-US',
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
      language: 'en-US',
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

    expect(getProofingState(host.current()).issues).toHaveLength(0);
    scheduler.destroy();
  });

  it('drops an answer in a language that is no longer the one being checked', async () => {
    const host = fakeView(stateOf(['alpha teh']));
    const clock = manualSchedule();
    const { client } = stubClient((request) =>
      flagFirstWord(request).then((answer) => ({ ...answer, language: 'de-DE' })),
    );

    const scheduler = createProofingScheduler({
      view: host.view,
      registry,
      noteId: 'note',
      language: 'en-US',
      client,
      schedule: clock.schedule,
    });

    scheduler.start();
    clock.run();
    await flush();

    expect(getProofingState(host.current()).issues).toHaveLength(0);
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
      language: 'en-US',
      client,
      schedule: clock.schedule,
    });

    scheduler.start();
    clock.run();
    expect(requests).toHaveLength(1);

    scheduler.destroy();
    gate.release?.({
      language: 'en-US',
      paragraphs: [{ id: requests[0].paragraphs[0].id, issues: [{ start: 6, end: 9, text: 'teh', kind: 'spelling', tone: 'error' }] }],
    });
    await flush();

    expect(getProofingState(host.current()).issues).toHaveLength(0);
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
      language: 'en-US',
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
    expect(getProofingState(host.current()).issues).toHaveLength(1);
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
      language: 'en-US',
      client,
      schedule: clock.schedule,
      retryMs: 2000,
    });

    scheduler.start();
    clock.run();
    await flush();
    expect(requests).toHaveLength(1);
    expect(getProofingState(host.current()).issues).toHaveLength(0);

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
      language: 'en-US',
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

  it('asks about a segment once per text, however many ticks go by', async () => {
    const host = fakeView(stateOf(['alpha teh', 'beta recieve']));
    const clock = manualSchedule();
    const { client, requests } = stubClient(flagFirstWord);

    const scheduler = createProofingScheduler({
      view: host.view,
      registry,
      noteId: 'note',
      language: 'en-US',
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
});
