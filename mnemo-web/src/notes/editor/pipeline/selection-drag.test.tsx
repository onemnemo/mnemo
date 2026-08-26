// @vitest-environment jsdom

import { EditorView } from 'prosemirror-view';
import { NodeSelection, TextSelection } from 'prosemirror-state';
import { afterEach, describe, expect, it } from 'vitest';

import { buildNoteEditState } from '../../edit/build-edit-state';
import { block, span } from '../mapper/fixtures';
import { blocksNativeTextDrag } from './selection-drag';

type Blocks = Parameters<typeof buildNoteEditState>[0];

let view: EditorView | null = null;
let mount: HTMLElement | null = null;

function open(blocks: Blocks): EditorView {
  const built = buildNoteEditState(blocks);
  if (!built.ok) throw new Error('fixture did not build');
  mount = document.createElement('div');
  document.body.appendChild(mount);
  view = new EditorView(mount, { state: built.state, editable: () => true });
  return view;
}

function markFirst(): void {
  let at = -1;
  view!.state.doc.descendants((node, pos) => {
    if (at < 0 && node.isTextblock && node.textContent === 'first') at = pos;
    return at < 0;
  });
  if (at < 0) throw new Error('no line reads "first"');
  const from = at + 1;
  view!.dispatch(
    view!.state.tr.setSelection(
      TextSelection.create(view!.state.doc, from, from + 'first'.length),
    ),
  );
}

function beginDrag(ctrlKey = false): boolean {
  const event = new MouseEvent('dragstart', {
    bubbles: true,
    cancelable: true,
    clientX: 10,
    clientY: 10,
    ctrlKey,
  });
  view!.dom.dispatchEvent(event);
  return event.defaultPrevented;
}

afterEach(() => {
  view?.destroy();
  mount?.remove();
  view = null;
  mount = null;
});

describe('blocksNativeTextDrag', () => {
  it('blocks a marked text range', () => {
    open([block('Text', [span('first')])]);
    markFirst();
    expect(blocksNativeTextDrag(view!.state.selection)).toBe(true);
  });

  it('leaves an empty text selection alone', () => {
    open([block('Text', [span('first')])]);
    expect(blocksNativeTextDrag(view!.state.selection)).toBe(false);
  });

  it('leaves a node selection alone', () => {
    open([block('Text', [span('first')])]);
    const selection = NodeSelection.create(view!.state.doc, 0);
    expect(blocksNativeTextDrag(selection)).toBe(false);
  });
});

describe('the dragstart the editor claims', () => {
  const two = (): Blocks => [block('Text', [span('first')]), block('Text', [span('second')])];

  it('refuses native drag and drop for selected text', () => {
    open(two());
    markFirst();
    expect(beginDrag()).toBe(true);
  });

  it('also refuses the Control copy gesture', () => {
    open(two());
    markFirst();
    expect(beginDrag(true)).toBe(true);
  });

  it('stays out of the way when nothing is marked', () => {
    open(two());
    expect(beginDrag()).toBe(false);
  });
});
