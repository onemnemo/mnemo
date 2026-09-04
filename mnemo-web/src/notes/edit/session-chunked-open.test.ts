// @vitest-environment jsdom

/**
 * That opening a large note actually chunks.
 *
 * The mount has always had the machinery: past a threshold it renders a first
 * slice synchronously and appends the rest across animation frames. What it did
 * not have was a chance to run. Assembling a session mounts the editor and
 * starts autosave in one call stack, and anything in that stack that reads the
 * document finishes the load on the spot, in a single synchronous transaction,
 * before the first frame is ever reached. The chunked mount then costs a branch
 * and buys nothing.
 *
 * So this is a test about scheduling, not about rendering: it asserts the view
 * is still holding its first slice once the session is assembled, and that the
 * scheduled append then fires and grows it. The counterpart in
 * `save/autosave-open-cost.test.ts` counts the reads that used to prevent that;
 * this one watches the consequence at the seam a real note open goes through.
 */

import { afterEach, describe, expect, it } from 'vitest';

import type { CommitOutcome, NoteSnapshot } from '../authority/authority';
import { scaleFixture } from '../editor/mapper/fixtures';
import { buildNoteEditState } from './build-edit-state';
import { createNoteSession, type NoteSession } from './session';

/** Matching the mount's own defaults, which a session does not let a caller override. */
const CHUNK_THRESHOLD = 2000;
const FIRST_CHUNK = 500;
const BLOCK_COUNT = 2400;

let open: NoteSession | null = null;

afterEach(async () => {
  if (open) await open.close();
  open = null;
  document.body.replaceChildren();
});

function openLargeNote(): { session: NoteSession; mount: HTMLElement; commits: NoteSnapshot[] } {
  const mount = document.createElement('div');
  document.body.appendChild(mount);

  const built = buildNoteEditState(scaleFixture(BLOCK_COUNT).blocks);
  if (!built.ok) throw new Error('fixture failed to build');
  expect(built.state.doc.childCount).toBeGreaterThan(CHUNK_THRESHOLD);

  const commits: NoteSnapshot[] = [];
  const session = createNoteSession({
    mount,
    noteId: 'note-large',
    sid: 'n0001',
    ver: 7,
    state: built.state,
    registry: built.registry,
    persist: async (snapshot): Promise<CommitOutcome> => {
      commits.push(snapshot);
      return { status: 'applied', ver: snapshot.ver + 1 };
    },
    // Long enough that no timer fires during the test; the note is never dirtied
    // here anyway, and a save would drain the mount on purpose.
    autosave: { debounceMs: 60_000, maxWaitMs: 60_000 },
  });
  open = session;

  // Exactly what the React seam does three lines after creating the session.
  expect(session.authority.status().saveState).toBe('loaded');

  return { session, mount, commits };
}

/** Resolves after one animation frame, the beat the mount schedules its appends on. */
function nextFrame(): Promise<void> {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

// Every case here opens a note past the chunk threshold, which is real synchronous work
// (building a 2400-block fixture, then draining chunked appends across animation frames)
// that runs well inside vitest's 5000ms default alone, but not always under a full-suite
// run sharing the machine with other heavy tests. Generous per-test timeouts, not a
// looser default: nothing else in this file needs one.
const GENEROUS = { timeout: 20000 };

describe('opening a note past the chunk threshold', () => {
  it('leaves the view holding only the first chunk once the session is assembled', GENEROUS, () => {
    const h = openLargeNote();
    expect(h.session.view.state.doc.childCount).toBe(FIRST_CHUNK);
  });

  it('runs the scheduled append at least once, which is what used to never happen', GENEROUS, async () => {
    const h = openLargeNote();
    const atOpen = h.session.view.state.doc.childCount;

    await nextFrame();

    expect(h.session.view.state.doc.childCount).toBeGreaterThan(atOpen);
  });

  it('finishes the document across further frames, and renders every block', GENEROUS, async () => {
    const h = openLargeNote();
    // Generously bounded rather than counted: the point is that it completes on
    // its own, not how many frames the chunk size divides into.
    for (let i = 0; i < 20 && h.session.view.state.doc.childCount < BLOCK_COUNT; i += 1) {
      await nextFrame();
    }

    expect(h.session.view.state.doc.childCount).toBe(BLOCK_COUNT);
    // Render proof: the editable DOM really does hold one element per block, so
    // the appends were rendered and not merely recorded in the state.
    const root = h.mount.querySelector('.ProseMirror');
    expect(root?.childElementCount).toBe(BLOCK_COUNT);
  });

  it('hands a save the whole document even while the load is still running', GENEROUS, async () => {
    // The rule chunking must never break. A snapshot mid-load drains first, so
    // what autosave commits is the note, never the part of it that had arrived.
    const h = openLargeNote();
    expect(h.session.view.state.doc.childCount).toBe(FIRST_CHUNK);

    expect(h.session.authority.snapshot().doc.childCount).toBe(BLOCK_COUNT);
    // And the drain went through the view, so nothing is left outstanding.
    expect(h.session.view.state.doc.childCount).toBe(BLOCK_COUNT);
  });

  it('takes an edit dispatched before anything has touched the editor', GENEROUS, () => {
    // What a file drop does, through the whole chain a real one goes through:
    // the transaction is built from `view.state` and dispatched, with no
    // focus, press or keystroke ahead of it to have finished the load.
    const h = openLargeNote();
    expect(h.session.view.state.doc.childCount).toBe(FIRST_CHUNK);

    h.session.view.dispatch(h.session.view.state.tr.insertText('x', 2));

    const saved = h.session.authority.snapshot();
    expect(saved.doc.childCount).toBe(BLOCK_COUNT);
    expect(saved.doc.child(0).textContent).toContain('x');
    expect(h.session.view.state.doc.childCount).toBe(BLOCK_COUNT);
  });
});
