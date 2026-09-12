// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { Selection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';

import { buildNoteEditState } from '../../edit/build-edit-state';
import { block, span } from '../mapper/fixtures';
import { undo } from '../history';

const views: EditorView[] = [];

afterEach(() => {
  while (views.length > 0) views.pop()!.destroy();
  document.body.replaceChildren();
});

function mount(text = ''): EditorView {
  const result = buildNoteEditState([block('Text', [span(text)])]);
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

function markedText(view: EditorView, markName: string): string {
  let text = '';
  view.state.doc.descendants((node) => {
    if (node.isText && node.marks.some((mark) => mark.type.name === markName)) text += node.text ?? '';
    return !node.isText;
  });
  return text;
}

describe('typed script shortcuts', () => {
  it('formats numeric runs when the following character ends them', () => {
    const view = mount();
    type(view, 'C_6H_12O_6 ');
    expect(view.state.doc.textContent).toBe('C6H12O6 ');
    expect(markedText(view, 'sub')).toBe('6126');
  });

  it('composes superscript and explicit subscript as ordinary marks', () => {
    const view = mount();
    type(view, 'E^0_{Reduction}');
    expect(view.state.doc.textContent).toBe('E0Reduction');
    expect(markedText(view, 'sup')).toBe('0');
    expect(markedText(view, 'sub')).toBe('Reduction');
  });

  it('accepts punctuation and signs inside braces', () => {
    const view = mount();
    type(view, 'SO_4^{2-} x_{i,j}');
    expect(view.state.doc.textContent).toBe('SO42- xi,j');
    expect(markedText(view, 'sub')).toBe('4i,j');
    expect(markedText(view, 'sup')).toBe('2-');
  });

  it('formats one non-numeric character only after its terminator arrives', () => {
    const view = mount();
    type(view, 'x^n');
    expect(view.state.doc.textContent).toBe('x^n');
    expect(markedText(view, 'sup')).toBe('');
    type(view, ' ');
    expect(view.state.doc.textContent).toBe('xn ');
    expect(markedText(view, 'sup')).toBe('n');
  });

  it('leaves identifier-like underscores literal unless braces make the intent explicit', () => {
    const literal = mount();
    type(literal, 'IMG_2024 ');
    expect(literal.state.doc.textContent).toBe('IMG_2024 ');
    expect(markedText(literal, 'sub')).toBe('');

    const explicit = mount();
    type(explicit, 'IMG_{2024}');
    expect(explicit.state.doc.textContent).toBe('IMG2024');
    expect(markedText(explicit, 'sub')).toBe('2024');
  });

  it('requires a base character before the marker', () => {
    const view = mount();
    type(view, '_2 ');
    expect(view.state.doc.textContent).toBe('_2 ');
    expect(markedText(view, 'sub')).toBe('');
  });

  it('leaves script syntax literal in code', () => {
    const result = buildNoteEditState([
      block('Code', [], { kind: 'code', language: 'text', source: 'x^2' }),
    ]);
    if (!result.ok) throw new Error(result.reason.message);
    const state = result.state.apply(result.state.tr.setSelection(Selection.atEnd(result.state.doc)));
    const root = document.createElement('div');
    document.body.appendChild(root);
    const view = new EditorView(root, { state });
    views.push(view);

    type(view, ' ');
    expect(view.state.doc.textContent).toBe('x^2 ');
    expect(markedText(view, 'sup')).toBe('');
  });

  it('uses the shared syntax in non-paragraph prose blocks', () => {
    const result = buildNoteEditState([block('BulletList', [span('x^2')])]);
    if (!result.ok) throw new Error(result.reason.message);
    const state = result.state.apply(result.state.tr.setSelection(Selection.atEnd(result.state.doc)));
    const root = document.createElement('div');
    document.body.appendChild(root);
    const view = new EditorView(root, { state });
    views.push(view);

    type(view, ' ');
    expect(view.state.doc.textContent).toBe('x2 ');
    expect(markedText(view, 'sup')).toBe('2');
  });

  it('restores the exact braced syntax in one undo step', () => {
    const view = mount();
    type(view, 'E_{Reduction}');
    expect(view.state.doc.textContent).toBe('EReduction');
    expect(undo(view.state, view.dispatch)).toBe(true);
    expect(view.state.doc.textContent).toBe('E_{Reduction}');
  });

  it('converts a pending run before Enter splits the block', () => {
    const view = mount();
    type(view, 'x^2');
    const handled = view.someProp('handleKeyDown', (handler) =>
      handler(view, new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })),
    );
    expect(handled).toBe(true);
    expect(view.state.doc.childCount).toBe(2);
    expect(view.state.doc.textContent).toBe('x2');
    expect(markedText(view, 'sup')).toBe('2');
  });
});
