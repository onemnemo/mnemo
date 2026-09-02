// @vitest-environment jsdom

/**
 * Block identity across a split, an undo and a redo.
 *
 * A sid is the one identifier the AI has already quoted back in chat, so the
 * block that was there has to keep its sid, and a redo must hand the block the
 * split created the same sid it was minted the first time.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';

import { editorSchema } from '../schema';
import { editorPlugins } from '../../edit/build-edit-state';
import { redo, undo } from '../history';

const { schema, registry, inline } = editorSchema();

const views: EditorView[] = [];
afterEach(() => {
  while (views.length > 0) views.pop()!.destroy();
  document.body.replaceChildren();
});

function para(text: string): PMNode {
  return schema.nodes.paragraph.create(
    { id: 'id-1', sid: 's0001' },
    schema.nodes.line.create(null, schema.text(text)),
  );
}

function mount(document_: PMNode, from: number): EditorView {
  const mountEl = window.document.createElement('div');
  window.document.body.appendChild(mountEl);
  const state = EditorState.create({
    schema,
    doc: document_,
    selection: TextSelection.create(document_, from),
    plugins: editorPlugins(registry, inline),
  });
  const view = new EditorView(mountEl, { state });
  views.push(view);
  return view;
}

function press(view: EditorView, key: string): boolean {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  return view.someProp('handleKeyDown', (f) => f(view, event)) === true;
}

function sids(view: EditorView): string[] {
  const out: string[] = [];
  view.state.doc.forEach((node) => out.push(String(node.attrs.sid)));
  return out;
}

describe('sids across a split, an undo and a redo', () => {
  it('keeps the existing sid on the block that was there and gives the new one a stable sid', () => {
    const view = mount(schema.nodes.doc.create(null, [para('hello')]), 2 + 2);
    press(view, 'Enter');
    const afterSplit = sids(view);
    expect(afterSplit[0]).toBe('s0001');
    expect(afterSplit[1]).not.toBe('');

    undo(view.state, view.dispatch);
    expect(sids(view)).toEqual(['s0001']);

    redo(view.state, view.dispatch);
    expect(sids(view)).toEqual(afterSplit);
  });
});
