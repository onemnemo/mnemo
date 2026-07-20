// @vitest-environment jsdom

/**
 * The live handle over a real view. The one behaviour worth proving is the one
 * `view.dispatch` would get wrong: `apply` has to return every transaction the
 * apply produced, including the ones invariant plugins append, or the version
 * counter downstream miscounts a single logical edit.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { EditorState, Plugin, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { createDocumentMapper } from '../mapper/document';
import { editorSchema } from '../schema';
import { defaultTextStyle, type Block } from '../../model/types';
import { createViewHandle } from './handle';

const { schema, registry } = editorSchema();
const mapper = createDocumentMapper(schema, registry);

afterEach(() => {
  document.body.replaceChildren();
});

function docOf(text: string): PMNode {
  const block: Block = {
    id: 'id-1',
    sid: 's0001',
    type: 'Text',
    spans: [{ kind: 'text', text, style: { ...defaultTextStyle } }],
    payload: { kind: 'empty' },
    meta: {},
    order: 0,
    children: null,
  };
  const result = mapper.toDoc([block]);
  if (!result.ok) throw new Error(`quarantined: ${result.reason.message}`);
  return result.doc;
}

/** Appends one transaction whenever an edit carried the `echo` meta. */
const echoPlugin = new Plugin({
  appendTransaction(trs, _old, newState) {
    if (!trs.some((tr) => tr.getMeta('echo'))) return null;
    return newState.tr.insertText('!', newState.selection.from);
  },
});

function mountView(text: string): { view: EditorView; el: HTMLElement } {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const state = EditorState.create({ doc: docOf(text), schema, plugins: [echoPlugin] });
  const view = new EditorView(el, { state });
  return { view, el };
}

describe('createViewHandle', () => {
  it('returns the dispatched transaction and everything appended to it', () => {
    const { view } = mountView('ab');
    const handle = createViewHandle(view);

    const tr = view.state.tr.insertText('Z', view.state.selection.from).setMeta('echo', true);
    const applied = handle.apply(tr);

    // The insert plus the plugin's appended echo — two, not one.
    expect(applied.transactions).toHaveLength(2);
    expect(applied.state.doc.textContent).toContain('Z');
    expect(applied.state.doc.textContent).toContain('!');
  });

  it('drives the view — the live state advances with each apply', () => {
    const { view } = mountView('ab');
    const handle = createViewHandle(view);

    const at = view.state.selection.from;
    handle.apply(view.state.tr.insertText('Q', at));

    expect(handle.state).toBe(view.state);
    expect(view.state.doc.textContent).toContain('Q');
  });

  it('a plain edit reports a single transaction', () => {
    const { view } = mountView('ab');
    const handle = createViewHandle(view);
    const applied = handle.apply(
      view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)),
    );
    expect(applied.transactions).toHaveLength(1);
  });

  it('throws on apply after destroy, and destroy is idempotent', () => {
    const { view, el } = mountView('ab');
    const handle = createViewHandle(view);

    handle.destroy();
    expect(el.querySelector('.ProseMirror')).toBeNull();
    expect(() => handle.apply(view.state.tr)).toThrow(/destroyed/);
    expect(() => handle.destroy()).not.toThrow();
  });
});
