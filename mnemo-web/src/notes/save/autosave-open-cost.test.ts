// @vitest-environment jsdom

/**
 * What starting autosave costs on the open path.
 *
 * The scheduler's decisions are about `dirty` and `rev`, never about the
 * document, so starting it must not ask for one. That is a performance question
 * everywhere and a correctness-shaped one on a large note: a chunked mount keeps
 * the rest of the document out of the view and finishes the load synchronously
 * the instant anything reads it, so a single document read taken while the
 * session is being assembled undoes the chunking completely, before the first
 * background frame has had a chance to run.
 *
 * These count the reads rather than time them. A timing assertion on a shared
 * machine says nothing; a read counter on the seam that does the draining says
 * exactly the thing that went wrong.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { createNoteAuthority, type CommitOutcome, type Persist } from '../authority/authority';
import type { EditorHandle } from '../authority/handle';
import { buildNoteEditState } from '../edit/build-edit-state';
import { scaleFixture } from '../editor/mapper/fixtures';
import { mountEditor, type MountedEditor } from '../editor/view/mount';
import { startAutosave, type Clock } from './autosave';

afterEach(() => {
  document.body.replaceChildren();
});

/** A clock that never fires on its own, so nothing here races a timer. */
const idleClock: Clock = {
  now: () => 1_000,
  schedule: () => () => {},
};

const persist: Persist = async (snapshot): Promise<CommitOutcome> => ({
  status: 'applied',
  ver: snapshot.ver + 1,
});

/** Counts every read of `state`, and is otherwise the handle it wraps. */
function countingHandle(inner: EditorHandle): { handle: EditorHandle; reads: () => number } {
  let reads = 0;
  return {
    reads: () => reads,
    handle: {
      get state() {
        reads += 1;
        return inner.state;
      },
      apply: (tr) => inner.apply(tr),
      destroy: () => {
        inner.destroy();
      },
    },
  };
}

/** A chunked mount, held back at its first chunk by a schedule that never runs. */
function chunkedMount(blockCount: number, firstChunkSize: number): MountedEditor {
  const built = buildNoteEditState(scaleFixture(blockCount).blocks);
  if (!built.ok) throw new Error('fixture failed to build');
  const mount = document.createElement('div');
  document.body.appendChild(mount);
  return mountEditor({
    mount,
    state: built.state,
    registry: built.registry,
    chunkThreshold: firstChunkSize,
    firstChunkSize,
    chunkSize: firstChunkSize,
    // Queued and never run: this is the window the real mount spends waiting for
    // its first animation frame, held open so a test can look inside it.
    schedule: () => {},
  });
}

describe('starting autosave over a freshly mounted session', () => {
  it('reads the handle state zero times', () => {
    const mounted = chunkedMount(12, 3);
    const { handle, reads } = countingHandle(mounted.handle);
    const authority = createNoteAuthority({
      noteId: 'note-1',
      sid: 'n0001',
      ver: 7,
      state: mounted.view.state,
      handle,
    });

    const before = reads();
    const autosave = startAutosave({ authority, persist, clock: idleClock });

    expect(reads() - before).toBe(0);

    autosave.destroy();
    mounted.destroy();
  });

  it('leaves the mount still chunked, so the background frames have work left', () => {
    // The consequence the read count is a proxy for. One document read here
    // drains every outstanding block in one synchronous transaction, and the
    // chunked mount stops existing as anything but code.
    const mounted = chunkedMount(12, 3);
    const authority = createNoteAuthority({
      noteId: 'note-1',
      sid: 'n0001',
      ver: 7,
      state: mounted.view.state,
      handle: mounted.handle,
    });

    const autosave = startAutosave({ authority, persist, clock: idleClock });
    // What the React seam reads three lines after the session is created.
    expect(authority.status().saveState).toBe('loaded');

    expect(mounted.view.state.doc.childCount).toBe(3);

    autosave.destroy();
    mounted.destroy();
  });

  it('still reports the same status a snapshot would', () => {
    // The doc-free read is only worth having if it answers the same question.
    const mounted = chunkedMount(12, 3);
    const authority = createNoteAuthority({
      noteId: 'note-1',
      sid: 'n0001',
      ver: 7,
      state: mounted.view.state,
      handle: mounted.handle,
    });

    const status = authority.status();
    // Taken second, so the drain it causes cannot be what made them agree.
    const snapshot = authority.snapshot();
    expect(status).toEqual({
      noteId: snapshot.noteId,
      sid: snapshot.sid,
      ver: snapshot.ver,
      rev: snapshot.rev,
      saveState: snapshot.saveState,
      dirty: snapshot.dirty,
    });

    mounted.destroy();
  });
});
