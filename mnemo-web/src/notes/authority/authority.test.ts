import { describe, expect, it } from 'vitest';
import { EditorState, Plugin } from 'prosemirror-state';

import { createDocumentMapper } from '../editor/mapper/document';
import { createEditorSchema } from '../editor/schema';
import { defaultTextStyle, type Block } from '../model/types';
import { createHeadlessHandle, type EditorHandle } from './handle';
import {
  createNoteAuthority,
  type CommitOutcome,
  type NoteAuthority,
  type NoteSnapshot,
} from './authority';

const { schema, registry } = createEditorSchema();
const mapper = createDocumentMapper(schema, registry);

function blockOf(text: string, index: number): Block {
  return {
    id: `id-${String(index)}`,
    sid: `s${String(index).padStart(4, '0')}`,
    type: 'Text',
    spans: [{ kind: 'text', text, style: { ...defaultTextStyle } }],
    payload: { kind: 'empty' },
    meta: {},
    order: index,
    children: null,
  };
}

function stateOf(texts: readonly string[], plugins: Plugin[] = []): EditorState {
  const result = mapper.toDoc(texts.map(blockOf));
  if (!result.ok) throw new Error(`quarantined: ${result.reason.message}`);
  return EditorState.create({ doc: result.doc, schema, plugins });
}

function authorityOf(texts: readonly string[] = ['hello'], plugins: Plugin[] = []): NoteAuthority {
  return createNoteAuthority({
    noteId: 'note-1',
    sid: 'n0001',
    ver: 7,
    state: stateOf(texts, plugins),
  });
}

/** A transaction that appends text to the first block. */
function typeInto(authority: NoteAuthority, text: string): Promise<unknown> {
  return authority.run((access) => {
    const tr = access.state.tr.insertText(text, 1);
    return access.apply(tr);
  });
}

function docText(snapshot: NoteSnapshot): string {
  return snapshot.doc.textContent;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('versions', () => {
  it('starts at the loaded version, clean, with no local revisions', () => {
    const snapshot = authorityOf().snapshot();
    expect(snapshot).toMatchObject({ ver: 7, rev: 0, dirty: false, saveState: 'loaded' });
  });

  it('increments the local revision once per change, and never the stored version', async () => {
    const authority = authorityOf();
    await typeInto(authority, 'a');
    await typeInto(authority, 'b');

    // Two edits, two revisions, and the persisted version untouched: nothing
    // has been written, so the base for the next commit has not moved.
    expect(authority.snapshot()).toMatchObject({ ver: 7, rev: 2, dirty: true, saveState: 'dirty' });
  });

  it('counts one revision for a change that plugins appended to', async () => {
    // An invariant that normalizes what an edit did. Its transaction is part of
    // the same logical change converging, not a second change.
    const invariant = new Plugin({
      appendTransaction(transactions, _old, next) {
        if (!transactions.some((each) => each.docChanged)) return null;
        if (next.doc.textContent.endsWith('!')) return null;
        return next.tr.insertText('!', next.doc.content.size - 1);
      },
    });

    const authority = authorityOf(['hello'], [invariant]);
    const result = await typeInto(authority, 'x');

    expect(result).toMatchObject({ rev: 1, changed: true });
    expect(docText(authority.snapshot())).toContain('!');
    expect(authority.snapshot().rev).toBe(1);
  });

  it('counts a change that only an appended transaction made', async () => {
    // The dispatched transaction changes nothing itself; the invariant reacting
    // to it does. Judging by the dispatched transaction alone would miss this
    // and leave a modified document reported as clean, which is the way a save
    // never happens at all.
    const invariant = new Plugin({
      appendTransaction(transactions, _old, next) {
        if (!transactions.some((each) => each.getMeta('normalize') === true)) return null;
        return next.tr.insertText('!', 1);
      },
    });

    const authority = authorityOf(['hello'], [invariant]);
    const result = await authority.run((access) =>
      access.apply(access.state.tr.setMeta('normalize', true)),
    );

    expect(result).toEqual({ rev: 1, changed: true });
    expect(docText(authority.snapshot())).toBe('!hello');
    expect(authority.snapshot().dirty).toBe(true);
  });

  it('does not count a transaction that leaves the document alone', async () => {
    const authority = authorityOf();
    const result = await authority.run((access) => {
      const tr = access.state.tr.setMeta('selection-ish', true);
      return access.apply(tr);
    });

    expect(result).toEqual({ rev: 0, changed: false });
    expect(authority.snapshot()).toMatchObject({ rev: 0, dirty: false, saveState: 'loaded' });
  });
});

describe('snapshots', () => {
  it('reads the document and its versions as one consistent tuple', async () => {
    const authority = authorityOf();
    const before = authority.snapshot();
    await typeInto(authority, 'z');

    // The earlier snapshot still describes the document it was taken from. A
    // caller holding it across an await commits the right doc under the right
    // version, rather than a new doc under an old version.
    expect(docText(before)).toBe('hello');
    expect(before.rev).toBe(0);
    expect(docText(authority.snapshot())).toBe('zhello');
  });
});

describe('serialization', () => {
  it('runs a dispatch behind a command that is still in flight', async () => {
    const authority = authorityOf();
    const gate = deferred<void>();
    const order: string[] = [];

    const slow = authority.run(async (access) => {
      order.push('slow:start');
      await gate.promise;
      access.apply(access.state.tr.insertText('1', 1));
      order.push('slow:end');
    });

    const fast = authority.run((access) => {
      order.push('fast');
      access.apply(access.state.tr.insertText('2', 1));
    });

    gate.resolve();
    await Promise.all([slow, fast]);

    expect(order).toEqual(['slow:start', 'slow:end', 'fast']);
    // '2' was inserted after '1' landed, so it reads the document '1' produced.
    expect(docText(authority.snapshot())).toBe('21hello');
    expect(authority.snapshot().rev).toBe(2);
  });

  it('gives a command the state as of when it runs, not when it was queued', async () => {
    const authority = authorityOf();
    let seen = '';

    const first = authority.run((access) => access.apply(access.state.tr.insertText('a', 1)));
    const second = authority.run((access) => {
      seen = access.state.doc.textContent;
    });

    await Promise.all([first, second]);
    expect(seen).toBe('ahello');
  });
});

/**
 * An authority plus a synchronous read of its live state.
 *
 * The authority exposes only snapshots, deliberately, a doc and a version have
 * to be read together, and `run` is the only way in for a command. A test of the
 * *synchronous* path cannot use `run` to build its transactions, because that
 * would resolve a microtask later, so it holds the handle it built the authority
 * with. That is exactly what the mount does with the live view handle.
 */
function localAuthority(): { authority: NoteAuthority; handle: EditorHandle } {
  const handle = createHeadlessHandle(stateOf(['hello']));
  const authority = createNoteAuthority({
    noteId: 'note-1',
    sid: 'n0001',
    ver: 7,
    state: handle.state,
    handle,
  });
  return { authority, handle };
}

describe('local dispatch', () => {
  it('applies before the call returns, with no await anywhere', () => {
    const { authority, handle } = localAuthority();
    const result = authority.dispatchLocal(handle.state.tr.insertText('x', 1));
    expect(result).toEqual({ rev: 1, changed: true });
    // The point of the whole method: readable *now*, not after a microtask.
    expect(docText(authority.snapshot())).toBe('xhello');
  });

  it('counts a revision and goes dirty exactly as the queued path does', () => {
    const { authority, handle } = localAuthority();
    authority.dispatchLocal(handle.state.tr.insertText('x', 1));
    expect(authority.snapshot()).toMatchObject({ rev: 1, dirty: true, saveState: 'dirty' });
  });

  it('does not count a transaction that changed no content', () => {
    const { authority, handle } = localAuthority();
    expect(authority.dispatchLocal(handle.state.tr)).toEqual({ rev: 0, changed: false });
    expect(authority.snapshot().dirty).toBe(false);
  });

  it('notifies subscribers synchronously', () => {
    const { authority, handle } = localAuthority();
    const seen: number[] = [];
    authority.subscribe((snapshot) => seen.push(snapshot.rev));
    authority.dispatchLocal(handle.state.tr.insertText('x', 1));
    expect(seen).toEqual([1]);
  });

  it('lands ahead of work already queued, because it never queues', async () => {
    const { authority, handle } = localAuthority();
    const gate = deferred<void>();
    const order: string[] = [];

    const queued = authority.run(async (access) => {
      await gate.promise;
      access.apply(access.state.tr.insertText('q', 1));
      order.push('queued');
    });

    authority.dispatchLocal(handle.state.tr.insertText('L', 1));
    order.push('local');

    gate.resolve();
    await queued;

    // Not a fairness bug, it is the contract. A keystroke cannot wait behind a
    // network round trip, and the queued command reads the live document when it
    // resumes, so it composes with what the user typed rather than clobbering it.
    expect(order).toEqual(['local', 'queued']);
    expect(docText(authority.snapshot())).toBe('qLhello');
    expect(authority.snapshot().rev).toBe(2);
  });

  it('throws on a destroyed authority rather than silently dropping the edit', () => {
    const { authority, handle } = localAuthority();
    const tr = handle.state.tr.insertText('x', 1);
    authority.destroy();
    expect(() => authority.dispatchLocal(tr)).toThrow(/destroyed/);
  });
});

describe('saving', () => {
  const applied = (ver: number) => async (): Promise<CommitOutcome> => ({ status: 'applied', ver });

  it('does nothing when there is nothing to save', async () => {
    const authority = authorityOf();
    let called = false;
    const result = await authority.save(async () => {
      called = true;
      return { status: 'applied', ver: 8 };
    });

    expect(result).toEqual({ status: 'skipped' });
    expect(called).toBe(false);
  });

  it('takes the stored version from the store, not from the local revision', async () => {
    const authority = authorityOf();
    await typeInto(authority, 'a');
    await typeInto(authority, 'b');
    await typeInto(authority, 'c');

    const result = await authority.save(applied(8));

    // Three local revisions, one commit: the store assigns the version, and it
    // moved by one because one write happened.
    expect(result).toEqual({ status: 'saved', ver: 8, stillDirty: false });
    expect(authority.snapshot()).toMatchObject({ ver: 8, rev: 3, dirty: false, saveState: 'saved' });
  });

  it('sends the snapshot the save was started at', async () => {
    const authority = authorityOf();
    await typeInto(authority, 'a');

    let sent: NoteSnapshot | null = null;
    await authority.save(async (snapshot) => {
      sent = snapshot;
      return { status: 'applied', ver: 8 };
    });

    expect(sent).not.toBeNull();
    expect(sent!.ver).toBe(7);
    expect(docText(sent!)).toBe('ahello');
  });

  it('reports saving while the write is in flight', async () => {
    const authority = authorityOf();
    await typeInto(authority, 'a');

    const gate = deferred<void>();
    const entered = deferred<void>();
    const saving = authority.save(async () => {
      entered.resolve();
      await gate.promise;
      return { status: 'applied', ver: 8 };
    });

    // Waited on the write actually starting rather than on a fixed number of
    // microtasks, which would make this test a hostage to scheduling details.
    await entered.promise;
    expect(authority.snapshot().saveState).toBe('saving');

    gate.resolve();
    await saving;
    expect(authority.snapshot().saveState).toBe('saved');
  });

  it('does not block edits while a write is in flight', async () => {
    const authority = authorityOf();
    await typeInto(authority, 'a');

    const gate = deferred<void>();
    const saving = authority.save(async () => {
      await gate.promise;
      return { status: 'applied', ver: 8 };
    });

    // The whole point of releasing the queue across the round trip: typing must
    // not wait for the server.
    await typeInto(authority, 'b');
    expect(docText(authority.snapshot())).toBe('bahello');

    gate.resolve();
    await saving;
  });

  it('stays in saving when an edit lands mid-write', async () => {
    const authority = authorityOf();
    await typeInto(authority, 'a');

    const gate = deferred<void>();
    const saving = authority.save(async () => {
      await gate.promise;
      return { status: 'applied', ver: 8 };
    });

    await typeInto(authority, 'b');
    // Reporting `dirty` here would tell a subscriber no write is happening,
    // while one is. The edit is still recorded, `rev` moved, and the save's
    // completion is what decides where this lands.
    expect(authority.snapshot()).toMatchObject({ saveState: 'saving', rev: 2, dirty: true });

    gate.resolve();
    await saving;
  });

  it('leaves the note dirty when an edit landed during the write', async () => {
    const authority = authorityOf();
    await typeInto(authority, 'a');

    const gate = deferred<void>();
    const saving = authority.save(async () => {
      await gate.promise;
      return { status: 'applied', ver: 8 };
    });

    await typeInto(authority, 'b');
    gate.resolve();

    // The acknowledgement is for revision 1; revision 2 exists and was never
    // persisted, so clearing the dirty flag here would lose it.
    expect(await saving).toEqual({ status: 'saved', ver: 8, stillDirty: true });
    expect(authority.snapshot()).toMatchObject({ ver: 8, rev: 2, dirty: true, saveState: 'dirty' });
  });

  it('refuses to start a second save while one is in flight', async () => {
    const authority = authorityOf();
    await typeInto(authority, 'a');

    const gate = deferred<void>();
    let writes = 0;
    const first = authority.save(async () => {
      writes += 1;
      await gate.promise;
      return { status: 'applied', ver: 8 };
    });
    const second = await authority.save(applied(9));

    expect(second).toEqual({ status: 'skipped' });
    gate.resolve();
    await first;
    expect(writes).toBe(1);
  });

  it('records a conflict without touching the document', async () => {
    const authority = authorityOf();
    await typeInto(authority, 'a');

    const result = await authority.save(async () => ({ status: 'conflict', ver: 12 }));

    expect(result).toEqual({ status: 'conflict', ver: 12 });
    // The version reported by the store is adopted so a rebase has something to
    // work from, but the document and its dirty state are left exactly as they
    // were, resolving is the caller's call.
    expect(authority.snapshot()).toMatchObject({ ver: 12, dirty: true, saveState: 'version_conflict' });
    expect(docText(authority.snapshot())).toBe('ahello');
  });

  it('keeps reporting the conflict when editing continues', async () => {
    const authority = authorityOf();
    await typeInto(authority, 'a');
    await authority.save(async () => ({ status: 'conflict', ver: 12 }));

    await typeInto(authority, 'b');

    // Not "dirty". Autosave has stopped on purpose, writing again would
    // overwrite the other writer, so a state meaning "this will be saved
    // shortly" would be a promise nothing intends to keep.
    expect(authority.snapshot()).toMatchObject({ saveState: 'version_conflict', dirty: true });
  });

  it('keeps the document and the dirty flag when the write throws', async () => {
    const authority = authorityOf();
    await typeInto(authority, 'a');

    const result = await authority.save(async () => {
      throw new Error('offline');
    });

    expect(result).toMatchObject({ status: 'failed' });
    expect(authority.snapshot()).toMatchObject({ ver: 7, dirty: true, saveState: 'save_failed' });
    expect(docText(authority.snapshot())).toBe('ahello');
  });

  it('can retry after a failure', async () => {
    const authority = authorityOf();
    await typeInto(authority, 'a');

    await authority.save(async () => {
      throw new Error('offline');
    });
    const retry = await authority.save(applied(8));

    expect(retry).toEqual({ status: 'saved', ver: 8, stillDirty: false });
    expect(authority.snapshot().saveState).toBe('saved');
  });
});

describe('subscribers', () => {
  it('notifies on a change, with the state after it', async () => {
    const authority = authorityOf();
    const seen: NoteSnapshot[] = [];
    authority.subscribe((snapshot) => seen.push(snapshot));

    await typeInto(authority, 'a');

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ rev: 1, dirty: true });
    expect(docText(seen[0]!)).toBe('ahello');
  });

  it('does not notify for a transaction that changed nothing', async () => {
    const authority = authorityOf();
    let calls = 0;
    authority.subscribe(() => {
      calls += 1;
    });

    await authority.run((access) => access.apply(access.state.tr.setMeta('noop', true)));
    expect(calls).toBe(0);
  });

  it('stops notifying after unsubscribe', async () => {
    const authority = authorityOf();
    let calls = 0;
    const off = authority.subscribe(() => {
      calls += 1;
    });

    await typeInto(authority, 'a');
    off();
    await typeInto(authority, 'b');

    expect(calls).toBe(1);
  });

  it('survives a listener that unsubscribes itself mid-notification', async () => {
    const authority = authorityOf();
    const seen: string[] = [];
    const off = authority.subscribe(() => {
      seen.push('self');
      off();
    });
    authority.subscribe(() => seen.push('other'));

    await typeInto(authority, 'a');
    await typeInto(authority, 'b');

    expect(seen).toEqual(['self', 'other', 'other']);
  });

  it('does not call a listener that was unsubscribed earlier in the same notification', async () => {
    // A component teardown cascade can remove a sibling's listener from inside
    // one of these. That listener has said it is gone, so calling it anyway
    // would hand a snapshot to something already torn down.
    const authority = authorityOf();
    const seen: string[] = [];
    let offSecond = (): void => undefined;

    authority.subscribe(() => {
      seen.push('first');
      offSecond();
    });
    offSecond = authority.subscribe(() => seen.push('second'));

    await typeInto(authority, 'a');
    expect(seen).toEqual(['first']);
  });

  it('reports each save transition', async () => {
    const authority = authorityOf();
    await typeInto(authority, 'a');

    const states: string[] = [];
    authority.subscribe((snapshot) => states.push(snapshot.saveState));
    await authority.save(async () => ({ status: 'applied', ver: 8 }));

    expect(states).toEqual(['saving', 'saved']);
  });
});

describe('destroy', () => {
  it('rejects further work rather than silently dropping it', async () => {
    const authority = authorityOf();
    const tr = stateOf(['hello']).tr.insertText('a', 1);
    authority.destroy();

    // All three reject rather than throwing synchronously, so a caller has one
    // error path. An edit that vanished without a word would be worse than either.
    await expect(authority.dispatch(tr)).rejects.toThrow('destroyed');
    await expect(authority.run(() => undefined)).rejects.toThrow('destroyed');
    await expect(authority.save(async () => ({ status: 'applied', ver: 8 }))).rejects.toThrow('destroyed');
  });

  it('drops its listeners', async () => {
    const authority = authorityOf();
    let calls = 0;
    authority.subscribe(() => {
      calls += 1;
    });

    await typeInto(authority, 'a');
    authority.destroy();
    expect(calls).toBe(1);
  });
});
