// @vitest-environment node

/**
 * Timing is the whole of this module, so the clock is driven by hand rather than
 * waited on: `tick(n)` advances a virtual now and fires whatever came due. That
 * turns "someone who never pauses still gets saved" into an assertion instead of
 * a five-second test.
 */

import { describe, expect, it } from 'vitest';
import { EditorState } from 'prosemirror-state';

import { createDocumentMapper } from '../editor/mapper/document';
import { createEditorSchema } from '../editor/schema';
import { createHeadlessHandle } from '../authority/handle';
import { createNoteAuthority, type CommitOutcome, type Persist } from '../authority/authority';
import { defaultTextStyle, type Block } from '../model/types';
import { startAutosave, type Clock } from './autosave';

const { schema, registry } = createEditorSchema();
const mapper = createDocumentMapper(schema, registry);

function stateOf(text: string): EditorState {
  const block: Block = {
    id: 'id-0',
    sid: 's0000',
    type: 'Text',
    spans: [{ kind: 'text', text, style: { ...defaultTextStyle } }],
    payload: { kind: 'empty' },
    meta: {},
    order: 0,
    children: null,
  };
  const result = mapper.toDoc([block]);
  if (!result.ok) throw new Error(`quarantined: ${result.reason.message}`);
  return EditorState.create({ doc: result.doc, schema });
}

/** A clock whose time only moves when a test moves it. */
function testClock() {
  let now = 1_000;
  let seq = 0;
  const due = new Map<number, { at: number; fn: () => void }>();

  const clock: Clock = {
    now: () => now,
    schedule(fn, ms) {
      const id = seq++;
      due.set(id, { at: now + ms, fn });
      return () => due.delete(id);
    },
  };

  function tick(ms: number): void {
    now += ms;
    for (const [id, entry] of [...due]) {
      if (entry.at <= now) {
        due.delete(id);
        entry.fn();
      }
    }
  }

  return { clock, tick, pending: () => due.size };
}

/** Lets every pending promise callback run before the assertion. */
function settle(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function harness() {
  const handle = createHeadlessHandle(stateOf('hello'));
  const authority = createNoteAuthority({
    noteId: 'note-1',
    sid: 'n0001',
    ver: 7,
    state: handle.state,
    handle,
  });
  const { clock, tick, pending } = testClock();

  /** The revision each commit carried, in order. */
  const commits: number[] = [];
  let answer: (ver: number) => CommitOutcome = (ver) => ({ status: 'applied', ver: ver + 1 });
  let gate: { promise: Promise<void>; open: () => void } | null = null;

  const persist: Persist = async (snapshot) => {
    commits.push(snapshot.rev);
    if (gate) await gate.promise;
    return answer(snapshot.ver);
  };

  return {
    authority,
    clock,
    tick,
    pending,
    commits,
    persist,
    /** What every subsequent commit answers. */
    answers(next: (ver: number) => CommitOutcome) {
      answer = next;
    },
    /** Holds commits open until {@link open}. */
    hold() {
      let open!: () => void;
      const promise = new Promise<void>((resolve) => {
        open = resolve;
      });
      gate = { promise, open };
    },
    open() {
      gate?.open();
      gate = null;
    },
    type(text: string) {
      authority.dispatchLocal(handle.state.tr.insertText(text, 1));
    },
    /** A dispatch that changes no content, a selection move, in effect. */
    noop() {
      authority.dispatchLocal(handle.state.tr);
    },
  };
}

function autosaveOn(h: ReturnType<typeof harness>, overrides: Record<string, unknown> = {}) {
  return startAutosave({
    authority: h.authority,
    persist: h.persist,
    clock: h.clock,
    ...overrides,
  });
}

describe('when it writes', () => {
  it('waits out the quiet period instead of writing on the keystroke', async () => {
    const h = harness();
    autosaveOn(h);
    h.type('a');

    h.tick(799);
    await settle();
    expect(h.commits).toEqual([]);

    h.tick(1);
    await settle();
    expect(h.commits).toEqual([1]);
  });

  it('restarts the quiet period on each edit', async () => {
    const h = harness();
    autosaveOn(h);
    h.type('a');
    h.tick(700);
    h.type('b');
    h.tick(700);
    await settle();
    // 1400ms after the first keystroke and still nothing, because the second
    // one moved the deadline.
    expect(h.commits).toEqual([]);

    h.tick(100);
    await settle();
    expect(h.commits).toEqual([2]);
  });

  it('writes anyway for someone who never pauses', async () => {
    // An edit every 700ms never leaves an 800ms gap, so the quiet period alone
    // would never fire, as the control below shows. The ceiling on the oldest
    // unsaved change is the whole reason this is a case autosave handles rather
    // than one it loses.
    async function typeSteadily(maxWaitMs: number): Promise<number> {
      const h = harness();
      autosaveOn(h, { maxWaitMs });
      for (let i = 0; i < 10; i++) {
        h.type('x');
        h.tick(700);
        await settle();
      }
      return h.commits.length;
    }

    expect(await typeSteadily(5_000)).toBeGreaterThan(0);
    // Same keystrokes, ceiling out of reach: nothing is ever written.
    expect(await typeSteadily(100_000)).toBe(0);
  });

  it('leaves a clean document alone', async () => {
    const h = harness();
    autosaveOn(h);
    h.tick(10_000);
    await settle();
    expect(h.commits).toEqual([]);
  });

  it('does not write a selection move', async () => {
    const h = harness();
    autosaveOn(h);
    h.noop();
    h.tick(10_000);
    await settle();
    expect(h.commits).toEqual([]);
  });

  it('gives an edit made during a write its own write afterwards', async () => {
    const h = harness();
    autosaveOn(h);
    h.hold();
    h.type('a');
    h.tick(800);
    await settle();
    expect(h.commits).toEqual([1]);

    // Typed while the first commit is still in the air. It was never part of
    // that snapshot, so it must not be counted as saved by its answer.
    h.type('b');
    h.open();
    await settle();
    expect(h.authority.snapshot().dirty).toBe(true);

    h.tick(800);
    await settle();
    expect(h.commits).toEqual([1, 2]);
    expect(h.authority.snapshot().dirty).toBe(false);
  });
});

describe('when it is switched off', () => {
  it('schedules nothing, however long the typing goes on', async () => {
    const h = harness();
    autosaveOn(h, { enabled: false });
    h.type('a');
    h.tick(100_000);
    await settle();
    expect(h.commits).toEqual([]);
    expect(h.pending()).toBe(0);
  });

  it('still writes on flush, because closing a note is not typing', async () => {
    const h = harness();
    const autosave = autosaveOn(h, { enabled: false });
    h.type('a');
    h.tick(100_000);
    await settle();

    expect(await autosave.flush()).toMatchObject({ status: 'saved' });
    expect(h.commits).toEqual([1]);
    expect(h.authority.snapshot().dirty).toBe(false);
  });

  it('leaves the scheduler running when it is on', async () => {
    const h = harness();
    autosaveOn(h, { enabled: true });
    h.type('a');
    h.tick(799);
    await settle();
    expect(h.commits).toEqual([]);

    h.tick(1);
    await settle();
    expect(h.commits).toEqual([1]);
  });
});

describe('when it is switched mid-session', () => {
  it('drops a write already waiting, without needing another edit to notice', async () => {
    let on = true;
    const h = harness();
    autosaveOn(h, { enabled: () => on });
    h.type('a');
    h.tick(400);
    expect(h.pending()).toBe(1);

    // No keystroke after the flip: the armed timer itself has to find the
    // setting off, since nothing else will run before it comes due.
    on = false;
    h.tick(100_000);
    await settle();
    expect(h.commits).toEqual([]);
    expect(h.pending()).toBe(0);
  });

  it('drops a retry a failed write had already armed', async () => {
    let on = true;
    const h = harness();
    h.answers(() => ({ status: 'failed', error: new Error('offline') }));
    autosaveOn(h, { enabled: () => on, retryDelaysMs: [100] });
    h.type('a');
    h.tick(800);
    await settle();
    expect(h.commits).toHaveLength(1);

    on = false;
    h.tick(100_000);
    await settle();
    expect(h.commits).toHaveLength(1);
  });

  it('takes the next edit, with a full quiet period rather than an expired ceiling', async () => {
    let on = false;
    const h = harness();
    autosaveOn(h, { enabled: () => on });
    h.type('a');
    h.tick(100_000);
    await settle();
    expect(h.commits).toEqual([]);

    on = true;
    h.type('b');
    h.tick(799);
    await settle();
    expect(h.commits).toEqual([]);

    h.tick(1);
    await settle();
    expect(h.commits).toEqual([2]);
    expect(h.authority.snapshot().dirty).toBe(false);
  });
});

describe('when a write fails', () => {
  it('retries on the given backoff', async () => {
    const h = harness();
    h.answers(() => ({ status: 'failed', error: new Error('offline') }));
    autosaveOn(h, { retryDelaysMs: [100, 200] });
    h.type('a');

    h.tick(800);
    await settle();
    expect(h.commits).toHaveLength(1);

    h.tick(100);
    await settle();
    expect(h.commits).toHaveLength(2);

    h.tick(200);
    await settle();
    expect(h.commits).toHaveLength(3);
  });

  it('stops once the retries run out', async () => {
    const h = harness();
    h.answers(() => ({ status: 'failed', error: new Error('offline') }));
    autosaveOn(h, { retryDelaysMs: [100] });
    h.type('a');

    h.tick(800);
    await settle();
    h.tick(100);
    await settle();
    expect(h.commits).toHaveLength(2);

    // Retrying a broken connection forever tells the user nothing new.
    h.tick(100_000);
    await settle();
    expect(h.commits).toHaveLength(2);
    expect(h.authority.snapshot().saveState).toBe('save_failed');
  });

  it('tries again when the document changes, which is the only new evidence there is', async () => {
    const h = harness();
    h.answers(() => ({ status: 'failed', error: new Error('offline') }));
    autosaveOn(h, { retryDelaysMs: [] });
    h.type('a');
    h.tick(800);
    await settle();
    expect(h.commits).toHaveLength(1);

    h.answers((ver) => ({ status: 'applied', ver: ver + 1 }));
    h.type('b');
    h.tick(800);
    await settle();
    expect(h.commits).toHaveLength(2);
    expect(h.authority.snapshot().dirty).toBe(false);
  });
});

describe('when a write conflicts', () => {
  it('stops, and stays stopped', async () => {
    const h = harness();
    h.answers(() => ({ status: 'conflict', ver: 12 }));
    autosaveOn(h);
    h.type('a');
    h.tick(800);
    await settle();
    expect(h.commits).toHaveLength(1);
    expect(h.authority.snapshot().saveState).toBe('version_conflict');

    // The authority has adopted version 12, so a retry would *succeed*, and
    // overwrite whatever the other writer stored with a document that never saw
    // it. Not retrying is the point.
    h.type('b');
    h.tick(100_000);
    await settle();
    expect(h.commits).toHaveLength(1);
  });

  it('refuses a flush too, because urgency does not make it safe', async () => {
    const h = harness();
    h.answers(() => ({ status: 'conflict', ver: 12 }));
    const autosave = autosaveOn(h);
    h.type('a');
    h.tick(800);
    await settle();

    h.type('b');
    expect(await autosave.flush()).toEqual({ status: 'skipped' });
    expect(h.commits).toHaveLength(1);
  });
});

describe('flush', () => {
  it('writes at once, without waiting out the quiet period', async () => {
    const h = harness();
    const autosave = autosaveOn(h);
    h.type('a');
    const result = await autosave.flush();
    expect(result).toMatchObject({ status: 'saved' });
    expect(h.commits).toEqual([1]);
  });

  it('is a no-op on a clean document', async () => {
    const h = harness();
    const autosave = autosaveOn(h);
    expect(await autosave.flush()).toEqual({ status: 'skipped' });
    expect(h.commits).toEqual([]);
  });

  it('waits for a write in flight, then writes what that one missed', async () => {
    const h = harness();
    const autosave = autosaveOn(h);
    h.hold();
    h.type('a');
    h.tick(800);
    await settle();
    expect(h.commits).toEqual([1]);

    h.type('b');
    const flushed = autosave.flush();
    h.open();
    await flushed;

    // Two commits, not one: the first could only ever persist the revision it
    // snapshotted, and 'b' arrived after that.
    expect(h.commits).toEqual([1, 2]);
    expect(h.authority.snapshot().dirty).toBe(false);
  });
});

describe('destroy', () => {
  it('stops scheduling', async () => {
    const h = harness();
    const autosave = autosaveOn(h);
    h.type('a');
    autosave.destroy();
    h.tick(100_000);
    await settle();
    expect(h.commits).toEqual([]);
  });

  it('does not write on its own, since flushing is the caller’s decision', async () => {
    const h = harness();
    const autosave = autosaveOn(h);
    h.type('a');
    autosave.destroy();
    await settle();
    expect(h.commits).toEqual([]);
  });

  it('leaves no timer behind', () => {
    const h = harness();
    const autosave = autosaveOn(h);
    h.type('a');
    expect(h.pending()).toBe(1);
    autosave.destroy();
    expect(h.pending()).toBe(0);
  });
});
