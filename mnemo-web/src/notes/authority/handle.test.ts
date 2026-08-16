import { describe, expect, it } from 'vitest';
import { EditorState, Plugin } from 'prosemirror-state';

import { createDocumentMapper } from '../editor/mapper/document';
import { createEditorSchema } from '../editor/schema';
import { defaultTextStyle, type Block } from '../model/types';
import { createHeadlessHandle } from './handle';

const { schema, registry } = createEditorSchema();
const mapper = createDocumentMapper(schema, registry);

const block: Block = {
  id: 'id-1',
  sid: 's0001',
  type: 'Text',
  spans: [{ kind: 'text', text: 'hello', style: { ...defaultTextStyle } }],
  payload: { kind: 'empty' },
  meta: {},
  order: 0,
  children: null,
};

function stateOf(plugins: Plugin[] = []): EditorState {
  const result = mapper.toDoc([block]);
  if (!result.ok) throw new Error(`quarantined: ${result.reason.message}`);
  return EditorState.create({ doc: result.doc, schema, plugins });
}

describe('headless handle', () => {
  it('advances its state', () => {
    const handle = createHeadlessHandle(stateOf());
    handle.apply(handle.state.tr.insertText('x', 1));
    expect(handle.state.doc.textContent).toBe('xhello');
  });

  it('returns the dispatched transaction and everything appended to it', () => {
    const invariant = new Plugin({
      appendTransaction(transactions, _old, next) {
        if (!transactions.some((each) => each.docChanged)) return null;
        if (next.doc.textContent.startsWith('!')) return null;
        return next.tr.insertText('!', 1);
      },
    });

    const handle = createHeadlessHandle(stateOf([invariant]));
    const applied = handle.apply(handle.state.tr.insertText('x', 1));

    // Both, in order. The authority counts logical changes off this list, so a
    // handle that reported only what it was given would hide every change an
    // invariant made on its own.
    expect(applied.transactions).toHaveLength(2);
    expect(applied.state.doc.textContent).toBe('!xhello');
    expect(applied.state).toBe(handle.state);
  });

  it('reports an appended transaction even when the dispatched one changed nothing', () => {
    const invariant = new Plugin({
      appendTransaction(transactions, _old, next) {
        if (!transactions.some((each) => each.getMeta('normalize') === true)) return null;
        return next.tr.insertText('!', 1);
      },
    });

    const handle = createHeadlessHandle(stateOf([invariant]));
    const applied = handle.apply(handle.state.tr.setMeta('normalize', true));

    expect(applied.transactions.map((each) => each.docChanged)).toEqual([false, true]);
  });

  it('refuses to apply once destroyed', () => {
    const handle = createHeadlessHandle(stateOf());
    const tr = handle.state.tr.insertText('x', 1);
    handle.destroy();

    // A view torn down while something still holds its handle must fail loudly.
    // Applying into a detached state would succeed and be silently discarded.
    expect(() => handle.apply(tr)).toThrow('destroyed');
    expect(handle.state.doc.textContent).toBe('hello');
  });
});
