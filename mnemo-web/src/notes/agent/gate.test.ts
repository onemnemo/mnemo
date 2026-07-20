import { describe, expect, it } from 'vitest';
import { EditorState } from 'prosemirror-state';

import { createEditorSchema } from '../editor/schema';
import { createDocumentMapper } from '../editor/mapper/document';
import { createInlineMapper } from '../editor/mapper/inline';
import { createNoteAuthority, type AuthorityAccess, type NoteSnapshot } from '../authority/authority';
import { defaultTextStyle, type Block, type InlineSpan } from '../model/types';
import { commitEdit, digestOf, prepareEdit, type PreparedEdit } from './gate';
import { compileOps, type CompileDeps } from './ops';
import type { DiffEntry, NoteOp } from './types';

const { schema, registry } = createEditorSchema();
const mapper = createDocumentMapper(schema, registry);
const inline = createInlineMapper(registry.marks, registry.inlines);

const plainParse = (md: string): InlineSpan[] => [
  { kind: 'text', text: md, style: { ...defaultTextStyle } },
];

const deps: CompileDeps = { schema, registry, mapper, inline, parseInline: plainParse };

const text = (t: string): InlineSpan => ({ kind: 'text', text: t, style: { ...defaultTextStyle } });

let counter = 0;
/** Sids are explicit: every test that commits has to name the block it targets. */
function blockOf(sid: string, body: string): Block {
  counter += 1;
  return {
    id: `id-${String(counter)}`,
    sid,
    type: 'Text',
    spans: [text(body)],
    payload: { kind: 'empty' },
    meta: {},
    order: 0,
    children: null,
  };
}

function stateOf(blocks: readonly Block[]): EditorState {
  const result = mapper.toDoc(blocks);
  if (!result.ok) throw new Error(`quarantined: ${result.reason.message}`);
  return EditorState.create({ doc: result.doc, schema });
}

/**
 * A standalone `AuthorityAccess`.
 *
 * The real authority only hands one out inside a queued command, which is the
 * property the gate relies on but makes a nuisance of testing a version that
 * moved without the document moving with it. This exposes the same surface with
 * the counters writable, so each refusal can be provoked one at a time. One
 * test at the bottom drives the gate through the genuine authority.
 */
function accessOf(
  blocks: readonly Block[],
  over: { noteId?: string; ver?: number } = {},
): AuthorityAccess & { ver: number; rev: number } {
  let state = stateOf(blocks);
  const self = {
    ver: over.ver ?? 1,
    rev: 0,
    get state() {
      return state;
    },
    snapshot(): NoteSnapshot {
      return {
        noteId: over.noteId ?? 'note-1',
        sid: 'n0001',
        doc: state.doc,
        ver: self.ver,
        rev: self.rev,
        saveState: 'loaded',
        dirty: false,
      };
    },
    apply(tr: Parameters<AuthorityAccess['apply']>[0]) {
      state = state.apply(tr);
      if (tr.docChanged) self.rev += 1;
      return { rev: self.rev, changed: tr.docChanged };
    },
  };
  return self;
}

/** Types into a block, the way a user would while an approval is on screen. */
function typeInto(access: AuthorityAccess & { rev: number }, at: number, body: string): void {
  access.apply(access.state.tr.insertText(body, at));
}

const textsOf = (state: EditorState) =>
  mapper.fromDoc(state.doc).map((b) => b.spans.map((s) => (s.kind === 'text' ? s.text : '')).join(''));

function prepared(access: AuthorityAccess, ops: NoteOp[]): PreparedEdit {
  const result = prepareEdit(access, ops, deps);
  if (!result.ok) throw new Error(`expected preparation to succeed: ${result.error.message}`);
  return result.prepared;
}

function refusal(access: AuthorityAccess, edit: PreparedEdit) {
  const result = commitEdit(access, edit, deps);
  if (result.ok) throw new Error('expected the commit to refuse');
  return result.refusal;
}

// ---------------------------------------------------------------------------

describe('preparation', () => {
  it('changes nothing', () => {
    const access = accessOf([blockOf('s0001', 'hello')]);
    const before = access.state;

    prepared(access, [{ op: 'set', id: 's0001', md: 'goodbye' }]);

    expect(access.state).toBe(before);
    expect(access.rev).toBe(0);
    expect(textsOf(access.state)).toEqual(['hello']);
  });

  it('reports the diff the user will be shown', () => {
    const access = accessOf([blockOf('s0001', 'hello')]);
    const edit = prepared(access, [{ op: 'set', id: 's0001', md: 'goodbye' }]);

    expect(edit.diff).toEqual<DiffEntry[]>([
      { kind: 'update', sid: 's0001', type: 'Text', before: 'hello', after: 'goodbye' },
    ]);
  });

  it('binds to the version it was prepared against', () => {
    const access = accessOf([blockOf('s0001', 'hello')], { ver: 7 });
    expect(prepared(access, [{ op: 'set', id: 's0001', md: 'x' }]).baseVer).toBe(7);
  });

  it('reports a compile failure instead of a capability', () => {
    const access = accessOf([blockOf('s0001', 'hello')]);
    const result = prepareEdit(access, [{ op: 'set', id: 'nope1', md: 'x' }], deps);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('not_found');
  });
});

describe('the digest', () => {
  it('is stable across compilations even though added blocks mint new ids', () => {
    const access = accessOf([blockOf('s0001', 'hello')]);
    const ops: NoteOp[] = [{ op: 'add', at: 's0001', where: 'after', blocks: [{ t: 'p', md: 'new' }] }];

    const first = prepared(access, ops);
    const second = prepared(access, ops);

    // The sids genuinely differ — that is the whole reason the digest cannot be
    // taken over the resulting document.
    expect(second.diff[0].sid).not.toBe(first.diff[0].sid);
    expect(second.digest).toBe(first.digest);
  });

  it('separates entries so text cannot forge a boundary', () => {
    const one = digestOf([{ kind: 'update', sid: 'a', type: 'Text', before: 'x', after: 'y' }]);
    const two = digestOf([{ kind: 'update', sid: 'a', type: 'Text', before: 'x", "y', after: '' }]);
    expect(one).not.toBe(two);
  });

  it('distinguishes entries that differ only in what happened to the block', () => {
    const removed = digestOf([{ kind: 'del', sid: 'a', type: 'Text', before: 'x' }]);
    const moved = digestOf([{ kind: 'move', sid: 'a', type: 'Text', before: 'x' }]);
    expect(removed).not.toBe(moved);
  });

  it('distinguishes an absent field from an empty one', () => {
    const absent = digestOf([{ kind: 'add', sid: 'a', type: 'Text' }]);
    const empty = digestOf([{ kind: 'add', sid: 'a', type: 'Text', after: '' }]);
    expect(absent).not.toBe(empty);
  });
});

describe('committing', () => {
  it('applies the approved edit', () => {
    const access = accessOf([blockOf('s0001', 'hello')]);
    const edit = prepared(access, [{ op: 'set', id: 's0001', md: 'goodbye' }]);

    const result = commitEdit(access, edit, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rev).toBe(1);
    expect(textsOf(access.state)).toEqual(['goodbye']);
  });

  it('leaves a document the schema still accepts', () => {
    const access = accessOf([blockOf('s0001', 'hello')]);
    const edit = prepared(access, [
      { op: 'add', at: 's0001', where: 'after', blocks: [{ t: 'h1', md: 'Title' }] },
    ]);

    expect(commitEdit(access, edit, deps).ok).toBe(true);
    access.state.doc.check();
  });

  it('refuses an edit prepared against another note', () => {
    const edit = prepared(accessOf([blockOf('s0001', 'hello')], { noteId: 'note-a' }), [
      { op: 'set', id: 's0001', md: 'x' },
    ]);
    // Sids are unique within a note, not across notes, so this batch would
    // otherwise resolve perfectly well against the wrong document.
    const elsewhere = accessOf([blockOf('s0001', 'hello')], { noteId: 'note-b' });

    expect(refusal(elsewhere, edit).reason).toBe('wrong_note');
    expect(textsOf(elsewhere.state)).toEqual(['hello']);
  });

  it('refuses when a commit landed underneath it', () => {
    const access = accessOf([blockOf('s0001', 'hello')], { ver: 4 });
    const edit = prepared(access, [{ op: 'set', id: 's0001', md: 'goodbye' }]);

    access.ver = 5;

    expect(refusal(access, edit)).toEqual({ reason: 'stale_version', expected: 4, actual: 5 });
    expect(textsOf(access.state)).toEqual(['hello']);
  });

  it('refuses when the targeted block changed under the approval', () => {
    const access = accessOf([blockOf('s0001', 'hello')]);
    const edit = prepared(access, [{ op: 'set', id: 's0001', md: 'goodbye' }]);

    typeInto(access, 2, 'wait ');

    // The version has not moved — nothing was persisted — so only the digest
    // can catch this.
    expect(refusal(access, edit).reason).toBe('document_changed');
    expect(textsOf(access.state)).toEqual(['wait hello']);
  });

  it('refuses when the block changed type under the approval', () => {
    const access = accessOf([blockOf('s0001', 'hello')]);
    const edit = prepared(access, [{ op: 'set', id: 's0001', md: 'goodbye' }]);

    // The user promotes the block to a heading. Not a character moves, so the
    // before and after text the preview showed are both still accurate — the
    // block type is the only thing that says this is no longer the same edit.
    const converted = compileOps(access.state, [{ op: 'type', id: 's0001', to: 'h1' }], deps);
    expect(converted.ok).toBe(true);
    if (!converted.ok) return;
    access.apply(converted.tr);

    expect(refusal(access, edit).reason).toBe('document_changed');
    expect(textsOf(access.state)).toEqual(['hello']);
  });

  it('reports the blocks that actually landed, not the ones preparation drew', () => {
    const access = accessOf([blockOf('s0001', 'hello')]);
    const edit = prepared(access, [
      { op: 'add', at: 's0001', where: 'after', blocks: [{ t: 'p', md: 'new' }] },
    ]);

    const result = commitEdit(access, edit, deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Commit recompiles, so it mints its own sid. Returning the approved diff
    // would hand back a sid that is nowhere in the document, and a caller that
    // used it to address the new block would get `not_found`.
    const sids = mapper.fromDoc(access.state.doc).map((b) => b.sid);
    expect(sids).toContain(result.diff[0].sid);
    expect(sids).not.toContain(edit.diff[0].sid);
  });

  it('refuses when the targeted block is gone', () => {
    const access = accessOf([blockOf('s0001', 'hello'), blockOf('s0002', 'world')]);
    const edit = prepared(access, [{ op: 'set', id: 's0002', md: 'goodbye' }]);

    const second = access.state.doc.firstChild!.nodeSize;
    access.apply(access.state.tr.delete(second, access.state.doc.content.size));

    const refused = refusal(access, edit);
    expect(refused.reason).toBe('no_longer_applies');
    if (refused.reason !== 'no_longer_applies') return;
    expect(refused.error.code).toBe('not_found');
    expect(textsOf(access.state)).toEqual(['hello']);
  });

  it('commits after a deletion that only moved the target', () => {
    const access = accessOf([blockOf('s0001', 'hello'), blockOf('s0002', 'world')]);
    const edit = prepared(access, [{ op: 'set', id: 's0002', md: 'goodbye' }]);

    // Removing the block *before* the target shifts every position after it.
    // Nothing the user approved changed, and the commit lands — which it only
    // can because the batch re-resolves by sid rather than replaying positions
    // captured at preparation.
    access.apply(access.state.tr.delete(0, access.state.doc.firstChild!.nodeSize));

    expect(commitEdit(access, edit, deps).ok).toBe(true);
    expect(textsOf(access.state)).toEqual(['goodbye']);
  });

  it('still commits after an edit that did not touch the batch', () => {
    const access = accessOf([blockOf('s0001', 'hello'), blockOf('s0002', 'elsewhere')]);
    const edit = prepared(access, [{ op: 'set', id: 's0001', md: 'goodbye' }]);

    // Typing in a block the batch never names. The revision moves and the gate
    // does not care: refusing on any local edit would reject an approval that
    // is still exactly what was shown.
    typeInto(access, access.state.doc.firstChild!.nodeSize + 2, 'still ');
    expect(access.rev).toBe(1);

    const result = commitEdit(access, edit, deps);
    expect(result.ok).toBe(true);
    expect(textsOf(access.state)).toEqual(['goodbye', 'still elsewhere']);
  });

  it('refuses a second commit of the same approval', () => {
    const access = accessOf([blockOf('s0001', 'hello')]);
    const edit = prepared(access, [{ op: 'set', id: 's0001', md: 'goodbye' }]);

    expect(commitEdit(access, edit, deps).ok).toBe(true);
    // Not idempotency for its own sake: the first commit changed the block, so
    // the same capability describes an edit that no longer matches.
    expect(refusal(access, edit).reason).toBe('document_changed');
    expect(textsOf(access.state)).toEqual(['goodbye']);
  });
});

describe('through the authority', () => {
  it('prepares and commits inside the queue', async () => {
    const authority = createNoteAuthority({
      noteId: 'note-1',
      sid: 'n0001',
      ver: 3,
      state: stateOf([blockOf('s0001', 'hello')]),
    });

    const edit = await authority.run((access) => prepared(access, [{ op: 'set', id: 's0001', md: 'goodbye' }]));
    const result = await authority.run((access) => commitEdit(access, edit, deps));

    expect(result.ok).toBe(true);
    const snapshot = authority.snapshot();
    expect(snapshot.rev).toBe(1);
    expect(snapshot.dirty).toBe(true);
    // The gate applies through the authority, so an agent edit is dirty like
    // any other and the ordinary save path picks it up.
    expect(snapshot.saveState).toBe('dirty');
    authority.destroy();
  });
});
