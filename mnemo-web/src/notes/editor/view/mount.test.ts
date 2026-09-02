// @vitest-environment jsdom

/**
 * The mount lifecycle: one view per note, and teardown that actually releases
 * it. These are the leak gates, exercised at the framework-free layer
 * `mountEditor` owns, the React hook adds nothing to the lifecycle it needs its
 * own coverage for beyond StrictMode wiring.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import { createDocumentMapper } from '../mapper/document';
import { editorSchema } from '../schema';
import { defaultTextStyle, type Block } from '../../model/types';
import { mountEditor } from './mount';
import { buildNoteEditState } from '../../edit/build-edit-state';
import { scaleFixture } from '../mapper/fixtures';
import { undo } from '../history';

const { schema, registry } = editorSchema();
const mapper = createDocumentMapper(schema, registry);

afterEach(() => {
  document.body.replaceChildren();
});

function container(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

function docOf(blocks: Block[]): PMNode {
  const result = mapper.toDoc(blocks);
  if (!result.ok) throw new Error(`quarantined: ${result.reason.message}`);
  return result.doc;
}

function textNote(text: string, sid = 's0001'): Block {
  return {
    id: `id-${sid}`,
    sid,
    type: 'Text',
    spans: [{ kind: 'text', text, style: { ...defaultTextStyle } }],
    payload: { kind: 'empty' },
    meta: {},
    order: 0,
    children: null,
  };
}

function equationNote(latex: string): Block {
  return {
    id: 'id-eq',
    sid: 's0002',
    type: 'Text',
    spans: [
      { kind: 'text', text: 'x', style: { ...defaultTextStyle } },
      { kind: 'equation', latex, style: { ...defaultTextStyle } },
    ],
    payload: { kind: 'empty' },
    meta: {},
    order: 0,
    children: null,
  };
}

function stateOf(blocks: Block[]): EditorState {
  return EditorState.create({ doc: docOf(blocks), schema });
}

describe('mountEditor lifecycle', () => {
  it('attaches exactly one editor to the mount', () => {
    const el = container();
    mountEditor({ mount: el, state: stateOf([textNote('hello')]), registry });
    expect(el.querySelectorAll('.ProseMirror')).toHaveLength(1);
    expect(el.textContent).toContain('hello');
  });

  it('destroy removes the editor from the DOM', () => {
    const el = container();
    const mounted = mountEditor({ mount: el, state: stateOf([textNote('bye')]), registry });
    mounted.destroy();
    expect(el.querySelector('.ProseMirror')).toBeNull();
  });

  it('a note switch leaves exactly one live editor, not two', () => {
    const el = container();
    // Switching notes is destroy-then-remount into the same mount element.
    const first = mountEditor({ mount: el, state: stateOf([textNote('one')]), registry });
    first.destroy();
    mountEditor({ mount: el, state: stateOf([textNote('two')]), registry });
    expect(el.querySelectorAll('.ProseMirror')).toHaveLength(1);
    expect(el.textContent).toContain('two');
    expect(el.textContent).not.toContain('one');
  });

  it('destroy is idempotent, the StrictMode double-invoke never double-frees', () => {
    const el = container();
    const mounted = mountEditor({ mount: el, state: stateOf([textNote('x')]), registry });
    mounted.destroy();
    expect(() => mounted.destroy()).not.toThrow();
    expect(el.querySelector('.ProseMirror')).toBeNull();
  });

  it('renders a registered realized view through the adapter', () => {
    const el = container();
    mountEditor({ mount: el, state: stateOf([equationNote('a^2')]), registry });
    // The equation NodeView produced by the adapter, not PM's default toDOM.
    expect(el.querySelector('.notes-equation')).not.toBeNull();
  });

  it('the handle reads the live view state', () => {
    const el = container();
    const mounted = mountEditor({ mount: el, state: stateOf([textNote('live')]), registry });
    expect(mounted.handle.state).toBe(mounted.view.state);
  });
});

describe('native spellcheck', () => {
  it('leaves an editable note to inherit the container settings', () => {
    // Stating it here would override the `spellcheck` and `lang` the document
    // container carries from the user's settings, which change without a remount.
    const el = container();
    mountEditor({ mount: el, state: stateOf([textNote('teh')]), registry, editable: true });
    expect(el.querySelector('.ProseMirror')!.getAttribute('spellcheck')).toBeNull();
  });

  it('turns the checker off for a read-only note', () => {
    // A reader cannot act on a squiggle, so a read-only note must not draw one.
    const el = container();
    mountEditor({ mount: el, state: stateOf([textNote('teh')]), registry, editable: false });
    expect(el.querySelector('.ProseMirror')!.getAttribute('spellcheck')).toBe('false');
  });
});

describe('chunked mount for large notes', () => {
  /** Fixture-built state, with the full plugin stack (history included). */
  function editState(count: number) {
    const built = buildNoteEditState(scaleFixture(count).blocks);
    if (!built.ok) throw new Error('fixture failed to build');
    return built;
  }

  /** A schedule stub that queues runners instead of firing them, so a test can step. */
  function stepQueue() {
    const queued: (() => void)[] = [];
    return {
      schedule: (run: () => void) => queued.push(run),
      runNext(): void {
        const run = queued.shift();
        if (!run) throw new Error('nothing was scheduled');
        run();
      },
      get pending(): number {
        return queued.length;
      },
    };
  }

  it('mounts a note under the threshold exactly as before, with nothing scheduled', () => {
    const el = container();
    const built = editState(20);
    const schedule = vi.fn();
    const mounted = mountEditor({
      mount: el,
      state: built.state,
      registry: built.registry,
      chunkThreshold: 2000,
      schedule,
    });
    expect(schedule).not.toHaveBeenCalled();
    expect(mounted.view.state.doc.childCount).toBe(20);
  });

  it('mounts only the first chunk synchronously, then grows one scheduled step at a time', () => {
    const el = container();
    const built = editState(12);
    const q = stepQueue();
    const mounted = mountEditor({
      mount: el,
      state: built.state,
      registry: built.registry,
      chunkThreshold: 5,
      firstChunkSize: 3,
      chunkSize: 4,
      schedule: q.schedule,
    });

    expect(mounted.view.state.doc.childCount).toBe(3);
    expect(q.pending).toBe(1);

    q.runNext(); // [3, 7)
    expect(mounted.view.state.doc.childCount).toBe(7);
    expect(q.pending).toBe(1);

    q.runNext(); // [7, 11)
    expect(mounted.view.state.doc.childCount).toBe(11);
    expect(q.pending).toBe(1);

    q.runNext(); // [11, 12)
    expect(mounted.view.state.doc.childCount).toBe(12);
    expect(q.pending).toBe(0);
  });

  it('does not let the load populate the undo stack', () => {
    const el = container();
    const built = editState(12);
    const q = stepQueue();
    const mounted = mountEditor({
      mount: el,
      state: built.state,
      registry: built.registry,
      chunkThreshold: 5,
      firstChunkSize: 3,
      chunkSize: 4,
      schedule: q.schedule,
    });
    while (q.pending > 0) q.runNext();

    expect(mounted.view.state.doc.childCount).toBe(12);
    // Dry run (no dispatch): true would mean there is something to undo.
    expect(undo(mounted.view.state)).toBe(false);
  });

  it('does not clobber a user edit made to the mounted prefix while the rest streams in', () => {
    const el = container();
    const built = editState(10);
    const q = stepQueue();
    const mounted = mountEditor({
      mount: el,
      state: built.state,
      registry: built.registry,
      chunkThreshold: 3,
      firstChunkSize: 3,
      chunkSize: 3,
      schedule: q.schedule,
    });
    expect(mounted.view.state.doc.childCount).toBe(3);

    // The ordinary edit path (PM's own default dispatch, nothing session-specific).
    mounted.view.dispatch(mounted.view.state.tr.insertText('!', 2));
    expect(mounted.view.state.doc.textBetween(0, mounted.view.state.doc.child(0).nodeSize)).toContain('!');

    while (q.pending > 0) q.runNext();

    expect(mounted.view.state.doc.childCount).toBe(10);
    expect(mounted.view.state.doc.textBetween(0, mounted.view.state.doc.child(0).nodeSize)).toContain('!');
  });

  it('never lets the handle report a document that is still only half loaded', () => {
    // The whole reason this matters: the authority's `snapshot()` reads
    // `handle.state.doc`, and autosave PUTs that as the entire note. A read
    // taken mid-load would commit the blocks that had arrived and delete every
    // block that had not, which is the one failure this editor must never have.
    const el = container();
    const built = editState(10);
    const q = stepQueue();
    const mounted = mountEditor({
      mount: el,
      state: built.state,
      registry: built.registry,
      chunkThreshold: 3,
      firstChunkSize: 3,
      chunkSize: 3,
      schedule: q.schedule,
    });

    expect(mounted.view.state.doc.childCount).toBe(3);
    expect(mounted.handle.state.doc.childCount).toBe(10);
  });

  it('an edit through the handle lands on the whole document, not the loaded part', () => {
    const el = container();
    const built = editState(10);
    const q = stepQueue();
    const mounted = mountEditor({
      mount: el,
      state: built.state,
      registry: built.registry,
      chunkThreshold: 3,
      firstChunkSize: 3,
      chunkSize: 3,
      schedule: q.schedule,
    });

    mounted.handle.apply(mounted.handle.state.tr.insertText('!', 2));
    expect(mounted.handle.state.doc.childCount).toBe(10);
    expect(mounted.handle.state.doc.child(0).textContent).toContain('!');
  });

  it('accepts an edit built against the loaded prefix, having never been read through the handle', () => {
    // How a file drop arrives: the transaction is built from `view.state`, and
    // a drop is preceded by no focus, press or keystroke to have finished the
    // load, so it is a transaction over a document that is still growing.
    const el = container();
    const built = editState(10);
    const q = stepQueue();
    const mounted = mountEditor({
      mount: el,
      state: built.state,
      registry: built.registry,
      chunkThreshold: 3,
      firstChunkSize: 3,
      chunkSize: 3,
      schedule: q.schedule,
    });
    expect(mounted.view.state.doc.childCount).toBe(3);

    const applied = mounted.handle.apply(mounted.view.state.tr.insertText('!', 2));

    // The edit landed, and the note is whole by the time the apply returns.
    expect(applied.state.doc.childCount).toBe(10);
    expect(mounted.handle.state.doc.childCount).toBe(10);
    expect(mounted.handle.state.doc.child(0).textContent).toContain('!');

    // A step scheduled before the apply drained finds nothing left to append.
    while (q.pending > 0) q.runNext();
    expect(mounted.view.state.doc.childCount).toBe(10);
  });

  it('still reads the whole document out of the handle after a teardown mid-load', () => {
    // Closing a note destroys the view at once and lets the final save commit
    // what the handle still answers with, so a truncated document here is the
    // note truncated in the store.
    const el = container();
    const built = editState(10);
    const q = stepQueue();
    const mounted = mountEditor({
      mount: el,
      state: built.state,
      registry: built.registry,
      chunkThreshold: 3,
      firstChunkSize: 3,
      chunkSize: 3,
      schedule: q.schedule,
    });
    expect(mounted.view.state.doc.childCount).toBe(3);

    mounted.destroy();

    expect(mounted.handle.state.doc.childCount).toBe(10);
    // Into the state the handle answers with, and not into the view: a
    // teardown that rendered the rest would pay the freeze chunking avoids,
    // for an editor already on its way out.
    expect(mounted.view.state.doc.childCount).toBe(3);
  });

  it('touching the editor finishes the load before any keystroke can build a transaction', () => {
    const el = container();
    const built = editState(10);
    const q = stepQueue();
    const mounted = mountEditor({
      mount: el,
      state: built.state,
      registry: built.registry,
      chunkThreshold: 3,
      firstChunkSize: 3,
      chunkSize: 3,
      schedule: q.schedule,
    });
    expect(mounted.view.state.doc.childCount).toBe(3);

    mounted.view.dom.dispatchEvent(new Event('focus'));
    // The view itself is whole now, so ProseMirror's own dispatch cannot build
    // a transaction against a prefix.
    expect(mounted.view.state.doc.childCount).toBe(10);

    // A tick scheduled before the drain may still be queued; it must find
    // nothing left to do rather than append a second copy of anything.
    while (q.pending > 0) q.runNext();
    expect(mounted.view.state.doc.childCount).toBe(10);
  });

  it('stops scheduling further chunks once destroyed mid-load', () => {
    const el = container();
    const built = editState(10);
    const q = stepQueue();
    const mounted = mountEditor({
      mount: el,
      state: built.state,
      registry: built.registry,
      chunkThreshold: 3,
      firstChunkSize: 3,
      chunkSize: 3,
      schedule: q.schedule,
    });

    expect(q.pending).toBe(1);
    mounted.destroy();
    expect(() => q.runNext()).not.toThrow();
    // The step ran, saw the mount was gone, and never scheduled the next one.
    expect(q.pending).toBe(0);
  });
});
