// @vitest-environment jsdom

/**
 * The ring: the view dispatches into the authority, the authority drives the
 * view through the handle it was built from, and autosave writes what the
 * authority holds. Each piece is tested on its own elsewhere; what is only
 * testable here is that they were wired to each other at all.
 */

import { afterEach, describe, expect, it } from 'vitest';

import type { CommitOutcome, NoteSnapshot } from '../authority/authority';
import { buildNoteEditState } from './build-edit-state';
import { createNoteSession, type NoteSession } from './session';
import { defaultTextStyle, type Block } from '../model/types';

function noteBlocks(text: string): Block[] {
  return [
    {
      id: 'id-0',
      sid: 's0000',
      type: 'Text',
      spans: [{ kind: 'text', text, style: { ...defaultTextStyle } }],
      payload: { kind: 'empty' },
      meta: {},
      order: 0,
      children: null,
    },
  ];
}

afterEach(() => {
  document.body.replaceChildren();
});

function harness(overrides: { commits?: NoteSnapshot[]; hold?: Promise<void> } = {}) {
  const mount = document.createElement('div');
  document.body.appendChild(mount);

  const built = buildNoteEditState(noteBlocks('hello'));
  if (!built.ok) throw new Error('quarantined');

  const commits = overrides.commits ?? [];
  const session = createNoteSession({
    mount,
    noteId: 'note-1',
    sid: 'n0001',
    ver: 7,
    state: built.state,
    registry: built.registry,
    persist: async (snapshot): Promise<CommitOutcome> => {
      commits.push(snapshot);
      if (overrides.hold) await overrides.hold;
      return { status: 'applied', ver: snapshot.ver + 1 };
    },
    // Long enough that nothing fires on its own; these tests drive saving
    // through `close`, and the scheduler's timing is covered where it lives.
    autosave: { debounceMs: 60_000, maxWaitMs: 60_000 },
  });

  return { mount, session, commits, type: (text: string) => typeInto(session, text) };
}

function typeInto(session: NoteSession, text: string): void {
  // The real path a keystroke takes: the view dispatches, and what it dispatches
  // to is the thing under test.
  session.view.dispatch(session.view.state.tr.insertText(text, 2));
}

describe('the view dispatch', () => {
  it('reaches the document the authority owns', () => {
    const h = harness();
    h.type('x');
    expect(h.session.authority.snapshot().doc.textContent).toBe('xhello');
  });

  it('updates the view before it returns', () => {
    const h = harness();
    h.type('x');
    // Not after a microtask. ProseMirror reads the DOM back against
    // `view.state`, so a state that lags the DOM duplicates or drops input.
    expect(h.session.view.state.doc.textContent).toBe('xhello');
    expect(h.mount.textContent).toContain('xhello');
  });

  it('counts a revision and marks the note dirty', () => {
    const h = harness();
    h.type('x');
    expect(h.session.authority.snapshot()).toMatchObject({ rev: 1, dirty: true });
  });

  it('counts one revision per dispatch, not per appended transaction', () => {
    const h = harness();
    h.type('a');
    h.type('b');
    // The invariant pipeline and the identity plugin append to these; a counter
    // that saw those as separate edits would over-count every keystroke.
    expect(h.session.authority.snapshot().rev).toBe(2);
  });
});

describe('close', () => {
  it('saves what has not been saved', async () => {
    const h = harness();
    h.type('x');
    await h.session.close();
    expect(h.commits).toHaveLength(1);
    expect(h.commits[0].doc.textContent).toBe('xhello');
  });

  it('writes nothing when there is nothing to write', async () => {
    const h = harness();
    await h.session.close();
    expect(h.commits).toEqual([]);
  });

  it('joins a close already under way rather than starting a second one', async () => {
    const h = harness();
    h.type('x');
    // StrictMode really does run cleanup twice, and the second call would
    // otherwise reach an authority the first one has destroyed.
    const [first, second] = await Promise.all([h.session.close(), h.session.close()]);
    expect(first).toEqual(second);
    expect(h.commits).toHaveLength(1);
  });

  it('releases the editor', async () => {
    const h = harness();
    await h.session.close();
    expect(h.mount.querySelector('.ProseMirror')).toBeNull();
  });

  it('releases the editor without waiting for the save to come back', async () => {
    let landed!: () => void;
    const held = new Promise<void>((resolve) => {
      landed = resolve;
    });
    const commits: NoteSnapshot[] = [];
    const h = harness({ commits, hold: held });

    h.type('x');
    const closed = h.session.close();
    await Promise.resolve();

    // A note switch must not leave a live editor on the mount point while a
    // commit is still in the air — StrictMode's remount would then make two.
    expect(h.mount.querySelector('.ProseMirror')).toBeNull();

    landed();
    await closed;
    // And the document it was holding still reached the server.
    expect(commits).toHaveLength(1);
    expect(commits[0].doc.textContent).toBe('xhello');
  });
});
