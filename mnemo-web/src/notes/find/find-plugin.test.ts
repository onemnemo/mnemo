import { describe, expect, it } from 'vitest';
import type { EditorState } from 'prosemirror-state';
import { buildNoteEditState } from '../edit/build-edit-state';
import { projectDocument } from '../editor/projection/document';
import { defaultTextStyle, type Block, type InlineSpan } from '../model/types';
import { findKey, getFindState } from './find-plugin';
import { searchDocument, type FindOptions } from './search';

let nextSid = 0;
function blockOf(over: Partial<Block> = {}): Block {
  nextSid += 1;
  return {
    id: `id-${String(nextSid)}`,
    sid: `s${String(nextSid).padStart(4, '0')}`,
    type: 'Text',
    spans: [{ kind: 'text', text: '', style: { ...defaultTextStyle } }],
    payload: { kind: 'empty' },
    meta: {},
    order: 0,
    children: null,
    ...over,
  };
}
const text = (t: string): InlineSpan => ({ kind: 'text', text: t, style: { ...defaultTextStyle } });
const INSENSITIVE: FindOptions = { caseSensitive: false, wholeWord: false };

function stateOf(blocks: readonly Block[]): { state: EditorState; registry: ReturnType<typeof build>['registry'] } {
  const built = build(blocks);
  return { state: built.state, registry: built.registry };
}
function build(blocks: readonly Block[]) {
  const result = buildNoteEditState(blocks);
  if (!result.ok) throw new Error(`quarantined: ${result.reason.message}`);
  return result;
}

describe('find plugin is view-only', () => {
  it('opening, searching, navigating and closing never change the document', () => {
    const { state, registry } = stateOf([blockOf({ spans: [text('alpha beta alpha')] })]);
    const matches = searchDocument(projectDocument(state.doc, registry), 'alpha', INSENSITIVE, state.doc);

    const open = state.apply(state.tr.setMeta(findKey, { type: 'open' }));
    const searched = open.apply(open.tr.setMeta(findKey, { type: 'setSearch', matches, activeIndex: 0 }));
    const stepped = searched.apply(searched.tr.setMeta(findKey, { type: 'setActive', activeIndex: 1 }));
    const closed = stepped.apply(stepped.tr.setMeta(findKey, { type: 'close' }));

    // The document node is identical throughout: no step, so the authority reads
    // docChanged false and never bumps the revision, dirties, or moves Ver.
    for (const next of [open, searched, stepped, closed]) {
      expect(next.doc).toBe(state.doc);
    }
  });

  it('produces a find meta transaction that reports no document change', () => {
    const { state } = stateOf([blockOf({ spans: [text('one')] })]);
    const tr = state.tr.setMeta(findKey, { type: 'open' });
    expect(tr.docChanged).toBe(false);
  });

  it('paints a decoration per match on setSearch and clears them on close', () => {
    const { state, registry } = stateOf([blockOf({ spans: [text('go go go')] })]);
    const matches = searchDocument(projectDocument(state.doc, registry), 'go', INSENSITIVE, state.doc);

    const searched = state.apply(state.tr.setMeta(findKey, { type: 'setSearch', matches, activeIndex: 0 }));
    expect(getFindState(searched).decorations.find().length).toBe(3);
    expect(getFindState(searched).open).toBe(true);

    const closed = searched.apply(searched.tr.setMeta(findKey, { type: 'close' }));
    expect(getFindState(closed).decorations.find().length).toBe(0);
    expect(getFindState(closed).open).toBe(false);
  });

  it('maps highlights forward and marks itself stale when the document changes', () => {
    const { state, registry } = stateOf([blockOf({ spans: [text('keep keep')] })]);
    const matches = searchDocument(projectDocument(state.doc, registry), 'keep', INSENSITIVE, state.doc);
    const searched = state.apply(state.tr.setMeta(findKey, { type: 'setSearch', matches, activeIndex: 0 }));
    const before = getFindState(searched).matches[1].from;

    // Insert text ahead of the matches, inside the block's own text: an ordinary
    // edit, no find meta.
    const edited = searched.apply(searched.tr.insertText('XX', matches[0].from));
    const after = getFindState(edited);
    expect(after.stale).toBe(true);
    // The second match shifted by the two inserted characters.
    expect(after.matches[1].from).toBe(before + 2);
    expect(after.decorations.find().length).toBe(2);
  });
});
