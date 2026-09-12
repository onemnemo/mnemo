// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { Selection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';

import { buildNoteEditState } from '../../edit/build-edit-state';
import { block, span } from '../mapper/fixtures';
import { toggleFormat } from '../marks/commands';

const views: EditorView[] = [];

afterEach(() => {
  while (views.length > 0) views.pop()!.destroy();
  document.body.replaceChildren();
});

function mount(): EditorView {
  const result = buildNoteEditState([block('Text', [span('x')])]);
  if (!result.ok) throw new Error(result.reason.message);
  const state = result.state.apply(result.state.tr.setSelection(Selection.atEnd(result.state.doc)));
  const root = document.createElement('div');
  document.body.appendChild(root);
  const view = new EditorView(root, { state });
  views.push(view);
  return view;
}

function type(view: EditorView, text: string): void {
  for (const character of text) {
    const { from, to } = view.state.selection;
    const handled = view.someProp('handleTextInput', (handler) =>
      handler(view, from, to, character, () => view.state.tr),
    );
    if (!handled) view.dispatch(view.state.tr.insertText(character, from, to));
  }
}

function press(view: EditorView, key: string, init: KeyboardEventInit = {}): boolean {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  return view.someProp('handleKeyDown', (handler) => handler(view, event)) === true;
}

function textHasMark(view: EditorView, text: string, markName: string): boolean {
  let found = false;
  view.state.doc.descendants((node) => {
    if (node.isText && node.text?.includes(text) && node.marks.some((mark) => mark.type.name === markName)) {
      found = true;
    }
    return !found && !node.isText;
  });
  return found;
}

describe('script assistance', () => {
  it('shows a subtle cue only while an explicitly armed script has focus', () => {
    const view = mount();
    view.focus();
    expect(toggleFormat('superscript')(view.state, view.dispatch)).toBe(true);
    expect(view.dom.querySelector('.notes-script-hint')?.getAttribute('data-script-hint')).toBe('x²');

    type(view, '2 ');
    expect(view.dom.querySelector('.notes-script-hint')).toBeNull();
  });

  it('ends script formatting on Space while preserving bold', () => {
    const view = mount();
    expect(toggleFormat('bold')(view.state, view.dispatch)).toBe(true);
    expect(toggleFormat('subscript')(view.state, view.dispatch)).toBe(true);
    type(view, '2 y');

    expect(view.state.doc.textContent).toBe('x2 y');
    expect(textHasMark(view, '2', 'sub')).toBe(true);
    expect(textHasMark(view, 'y', 'sub')).toBe(false);
    expect(textHasMark(view, 'y', 'strong')).toBe(true);
  });

  it('uses Escape as a script-only recovery key', () => {
    const view = mount();
    expect(toggleFormat('bold')(view.state, view.dispatch)).toBe(true);
    expect(toggleFormat('superscript')(view.state, view.dispatch)).toBe(true);
    expect(press(view, 'Escape')).toBe(true);
    type(view, '2');

    expect(textHasMark(view, '2', 'sup')).toBe(false);
    expect(textHasMark(view, '2', 'strong')).toBe(true);
    expect(press(view, 'Escape')).toBe(false);
  });

  it('lets an open find surface consume Escape before the armed script', () => {
    const view = mount();
    expect(toggleFormat('superscript')(view.state, view.dispatch)).toBe(true);
    expect(press(view, 'f', { ctrlKey: true })).toBe(true);

    expect(press(view, 'Escape')).toBe(true);
    expect(view.state.storedMarks?.some((mark) => mark.type.name === 'sup')).toBe(true);
    expect(press(view, 'Escape')).toBe(true);
    expect(view.state.storedMarks?.some((mark) => mark.type.name === 'sup')).toBe(false);
  });
});
