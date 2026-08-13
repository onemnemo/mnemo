// @vitest-environment jsdom

/**
 * Manual saving, through the whole stack the editor actually uses: a real
 * session, a real autosave scheduler with the setting switched off, and the real
 * key listener on top of them.
 *
 * The point is the case the product cannot get wrong. With autosave off nothing
 * writes on its own, so every one of these assertions is the difference between
 * a note being on disk and a note being lost.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { EditorView } from 'prosemirror-view';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useSettingsStore } from '@/settings/store';
import type { CommitOutcome, NoteSnapshot } from '../authority/authority';
import { defaultTextStyle, type Block } from '../model/types';
import { useSaveShortcut } from '../save/useSaveShortcut';
import { buildNoteEditState, type NoteEditState } from './build-edit-state';
import { useNoteSession } from './useNoteSession';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

/** Everything the test needs to reach into the running session. */
interface Probe {
  view: EditorView | null;
  saveState: string;
}

const probe: Probe = { view: null, saveState: 'loading' };

/** Built once per test, so the component body stays free of conditional work. */
let built: Extract<NoteEditState, { ok: true }>;

/** What NoteSurface composes, with the chrome left off. */
function Editor({ noteId, persist }: { noteId: string; persist: (snapshot: NoteSnapshot) => Promise<CommitOutcome> }) {
  const { ref, saveState, view, save } = useNoteSession({
    noteId,
    sid: 'n0001',
    ver: 7,
    state: built.state,
    registry: built.registry,
    persist,
    // Long enough that nothing can fire on its own, so a write in these tests is
    // only ever one the test asked for.
    autosave: { debounceMs: 60_000, maxWaitMs: 60_000 },
  });
  useSaveShortcut(save);

  probe.view = view;
  probe.saveState = saveState;
  return <div ref={ref} />;
}

let container: HTMLElement;
let root: Root;
let mounted: boolean;
let commits: NoteSnapshot[];
/** Held open by a test that wants to watch a save in flight. */
let gate: { promise: Promise<void>; open: () => void } | null;
let outcome: (snapshot: NoteSnapshot) => CommitOutcome;

async function persist(snapshot: NoteSnapshot): Promise<CommitOutcome> {
  commits.push(snapshot);
  if (gate) await gate.promise;
  return outcome(snapshot);
}

function openGate(): void {
  let open = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  gate = { promise, open };
}

function render(noteId = 'note-1'): void {
  // Not StrictMode: these tests count writes, and the deliberate double mount
  // would double the mount-time behaviour they are counting.
  act(() => root.render(<Editor noteId={noteId} persist={persist} />));
  mounted = true;
}

function unmount(): void {
  if (!mounted) return;
  mounted = false;
  act(() => root.unmount());
}

/** One keystroke, through the view the way the editor dispatches. */
function type(text: string): void {
  const view = probe.view;
  if (!view) throw new Error('no view');
  act(() => {
    view.dispatch(view.state.tr.insertText(text, 2));
  });
}

function pressCtrlS(): void {
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, code: 'KeyS', key: 's', ctrlKey: true }),
    );
  });
}

/** Lets every already-resolved promise in the save chain run out. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  });
}

beforeEach(() => {
  const state = buildNoteEditState(noteBlocks('hello'));
  if (!state.ok) throw new Error('quarantined');
  built = state;

  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  mounted = false;
  commits = [];
  gate = null;
  outcome = (snapshot) => ({ status: 'applied', ver: snapshot.ver + 1 });
  probe.view = null;
  probe.saveState = 'loading';
  // Autosave off is the state this whole feature exists for.
  useSettingsStore.setState({ values: { 'Editor.AutoSave': false }, loaded: true });
});

afterEach(() => {
  unmount();
  container.remove();
  useSettingsStore.setState({ values: {}, loaded: false });
});

describe('saving a note by hand', () => {
  it('writes what was typed, which nothing else was going to do', async () => {
    render();
    type('x');
    expect(commits).toHaveLength(0);

    pressCtrlS();
    await settle();

    expect(commits).toHaveLength(1);
    expect(commits[0].doc.textContent).toBe('xhello');
  });

  it('reports the note as saved afterwards, and as unsaved again on the next keystroke', async () => {
    render();
    type('x');
    expect(probe.saveState).toBe('dirty');

    pressCtrlS();
    await settle();
    expect(probe.saveState).toBe('saved');

    type('y');
    expect(probe.saveState).toBe('dirty');
  });

  it('does not say saved when the write failed', async () => {
    outcome = () => ({ status: 'failed', error: new Error('offline') });
    render();
    type('x');
    pressCtrlS();
    await settle();

    expect(probe.saveState).toBe('save_failed');
  });

  it('writes once for a burst of presses, not once per press', async () => {
    render();
    type('x');
    pressCtrlS();
    pressCtrlS();
    pressCtrlS();
    await settle();

    // The first press takes the document; the rest find nothing left unsaved.
    expect(commits).toHaveLength(1);
  });

  it('waits out a save already in flight rather than racing a second one against it', async () => {
    openGate();
    render();
    type('x');
    pressCtrlS();
    await settle();
    expect(commits).toHaveLength(1);
    expect(probe.saveState).toBe('saving');

    // Typed during the round trip, so the write in flight does not cover it.
    type('y');
    pressCtrlS();
    await settle();
    expect(commits).toHaveLength(1);

    gate?.open();
    gate = null;
    await settle();

    // The keystroke the first write never saw is written once the first settles.
    expect(commits).toHaveLength(2);
    expect(commits[1].doc.textContent).toBe('yxhello');
    expect(probe.saveState).toBe('saved');
  });

  it('does nothing on a note nobody has touched', async () => {
    render();
    pressCtrlS();
    await settle();

    expect(commits).toHaveLength(0);
    // Not "Saved": nothing was saved, and saying otherwise about an untouched
    // note is the flash this chrome is built to avoid.
    expect(probe.saveState).toBe('loaded');
  });

  it('saves anyway when autosave is on, because the keystroke is a habit not a mode', async () => {
    useSettingsStore.setState({ values: { 'Editor.AutoSave': true }, loaded: true });
    render();
    type('x');
    pressCtrlS();
    await settle();

    expect(commits).toHaveLength(1);
  });
});

describe('leaving a note with unsaved work', () => {
  it('writes it on the way out, even with autosave off', async () => {
    render();
    type('x');
    expect(commits).toHaveLength(0);

    unmount();
    await settle();

    expect(commits).toHaveLength(1);
    expect(commits[0].doc.textContent).toBe('xhello');
  });

  it('writes it when the pane switches to another note', async () => {
    render('note-1');
    type('x');

    act(() => root.render(<Editor noteId="note-2" persist={persist} />));
    await settle();

    expect(commits.map((c) => c.noteId)).toEqual(['note-1']);
    expect(commits[0].doc.textContent).toBe('xhello');
  });
});
