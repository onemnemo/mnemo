// @vitest-environment jsdom

/**
 * Enter and Backspace driven through the real plugin stack, which is where the
 * history grouping and the invariant pipeline are in play: what a split leaves
 * around a soft break, what a range delete across a heading boundary leaves, and
 * how many presses of undo a split costs.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';

import { editorSchema } from '../schema';
import { editorPlugins } from '../../edit/build-edit-state';
import { undo } from '../history';

const { schema, registry, inline } = editorSchema();

const views: EditorView[] = [];
afterEach(() => {
  while (views.length > 0) views.pop()!.destroy();
  document.body.replaceChildren();
});

function line(text?: string): PMNode {
  return schema.nodes.line.create(null, text ? schema.text(text) : null);
}
function block(name: string, text?: string, attrs?: Record<string, unknown>): PMNode {
  return schema.nodes[name].create(attrs ?? null, line(text));
}
function doc(...blocks: PMNode[]): PMNode {
  return schema.nodes.doc.create(null, blocks);
}

function mount(document_: PMNode, from: number, to = from): EditorView {
  const mountEl = window.document.createElement('div');
  window.document.body.appendChild(mountEl);
  const state = EditorState.create({
    schema,
    doc: document_,
    selection: TextSelection.create(document_, from, to),
    plugins: editorPlugins(registry, inline),
  });
  const view = new EditorView(mountEl, { state });
  views.push(view);
  return view;
}

function press(view: EditorView, key: string, init: KeyboardEventInit = {}): boolean {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  return view.someProp('handleKeyDown', (f) => f(view, event)) === true;
}

function typeChar(view: EditorView, text: string): void {
  const { from, to } = view.state.selection;
  const deflt = () => view.state.tr.insertText(text, from, to);
  const claimed = view.someProp('handleTextInput', (f) => f(view, from, to, text, deflt)) === true;
  if (!claimed) view.dispatch(deflt());
}

function caretAt(document_: PMNode, index: number, offset: number): number {
  let start = -1;
  document_.forEach((_node, off, i) => {
    if (i === index) start = off;
  });
  return start + 2 + offset;
}

function shape(view: EditorView): string {
  const parts: string[] = [];
  view.state.doc.forEach((node) => parts.push(`${node.type.name}(${JSON.stringify(node.textContent)})`));
  return parts.join(' | ');
}

describe('Enter next to a soft break', () => {
  it('at the end of the first soft-wrapped line, splits into two clean blocks', () => {
    // Shift+Enter then Enter is the ordinary way a soft-wrapped block gets
    // turned back into two blocks.
    const document_ = doc(block('paragraph', 'one\ntwo'));
    const view = mount(document_, caretAt(document_, 0, 3));
    press(view, 'Enter');
    expect(shape(view)).toBe('paragraph("one") | paragraph("two")');
  });

  it('at the start of the second soft-wrapped line, splits into two clean blocks', () => {
    const document_ = doc(block('paragraph', 'one\ntwo'));
    const view = mount(document_, caretAt(document_, 0, 4));
    press(view, 'Enter');
    expect(shape(view)).toBe('paragraph("one") | paragraph("two")');
  });
});

describe('deleting a range that runs from a heading into the paragraph below', () => {
  it('leaves one heading holding both surviving halves', () => {
    const document_ = doc(block('heading', 'Title', { level: 1 }), block('paragraph', 'body'));
    const view = mount(document_, caretAt(document_, 0, 2), caretAt(document_, 1, 2));
    press(view, 'Backspace');
    expect(shape(view)).toBe('heading("Tidy")');
  });
});

describe('deleting a range that runs from a paragraph into the heading below', () => {
  it('leaves one paragraph holding both surviving halves', () => {
    const document_ = doc(block('paragraph', 'body'), block('heading', 'Title', { level: 1 }));
    const view = mount(document_, caretAt(document_, 0, 2), caretAt(document_, 1, 2));
    press(view, 'Backspace');
    expect(shape(view)).toBe('paragraph("botle")');
  });
});

describe('undo after a split', () => {
  it('one press takes back the split and leaves the typing intact', () => {
    const document_ = doc(block('paragraph'));
    const view = mount(document_, caretAt(document_, 0, 2 - 2));
    typeChar(view, 'a');
    typeChar(view, 'b');
    press(view, 'Enter');
    typeChar(view, 'c');
    // Back over the "c", then back over the split.
    undo(view.state, view.dispatch);
    undo(view.state, view.dispatch);
    expect(shape(view)).toBe('paragraph("ab")');
  });
});
