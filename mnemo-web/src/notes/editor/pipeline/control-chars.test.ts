// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { EditorState, Selection, TextSelection, type Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';

import { createEditorSchema } from '../schema';
import { controlCharGuard, controlCharTextInputGuard, stripControlChars } from './control-chars';

const { schema } = createEditorSchema();

function line(text?: string): PMNode {
  return schema.nodes.line.create(null, text ? schema.text(text) : null);
}
function para(text?: string): PMNode {
  return schema.nodes.paragraph.create(null, line(text));
}
function doc(...blocks: PMNode[]): PMNode {
  return schema.nodes.doc.create(null, blocks);
}

function caretAt(offset: number): number {
  return 2 + offset;
}

describe('stripControlChars', () => {
  it('drops a null byte', () => {
    expect(stripControlChars('a\u0000b')).toBe('ab');
  });

  it('drops the whole C0 range other than tab and newline', () => {
    let all = '';
    for (let code = 0x00; code <= 0x1f; code++) all += String.fromCharCode(code);
    expect(stripControlChars(all)).toBe('\u0009\u000a');
  });

  it('drops delete (U+007F)', () => {
    expect(stripControlChars('a\u007fb')).toBe('ab');
  });

  it('leaves ordinary text untouched', () => {
    expect(stripControlChars('Hello, world! 42%')).toBe('Hello, world! 42%');
  });
});

/** Offers `text` to the guard the way prosemirror-view does, without a DOM event. */
function typeText(document: PMNode, at: number, text: string): { handled: boolean; state: EditorState } {
  const plugin = controlCharTextInputGuard();
  const state = EditorState.create({ schema, doc: document, plugins: [plugin] });
  const view = {
    state,
    composing: false,
    dispatch(tr: Transaction) {
      view.state = view.state.apply(tr);
    },
  };
  const handled = plugin.props.handleTextInput!.call(
    plugin,
    view as unknown as EditorView,
    at,
    at,
    text,
    () => view.state.tr,
  );
  return { handled: Boolean(handled), state: view.state };
}

describe('controlCharTextInputGuard', () => {
  it('drops a typed control character and inserts the rest', () => {
    const document = doc(para('ab'));
    const { handled, state } = typeText(document, caretAt(2), 'c\u0001');
    expect(handled).toBe(true);
    expect(state.doc.textContent).toBe('abc');
  });

  it('declines a run of ordinary typed text, leaving the default handler to insert it', () => {
    const document = doc(para(''));
    const { handled } = typeText(document, caretAt(0), 'x');
    expect(handled).toBe(false);
  });

  it('keeps tab and newline out of what it strips', () => {
    const document = doc(para(''));
    const { handled } = typeText(document, caretAt(0), '\t\n');
    // Nothing to strip, so the default handler inserts the tab and newline.
    expect(handled).toBe(false);
  });

  it('declines while a composition is in flight', () => {
    const plugin = controlCharTextInputGuard();
    const document = doc(para(''));
    const state = EditorState.create({ schema, doc: document, plugins: [plugin] });
    const view = { state, composing: true, dispatch: () => undefined };
    const handled = plugin.props.handleTextInput!.call(
      plugin,
      view as unknown as EditorView,
      caretAt(0),
      caretAt(0),
      'x\u0001',
      () => view.state.tr,
    );
    expect(Boolean(handled)).toBe(false);
  });
});

describe('controlCharGuard', () => {
  it('strips a control character a plain transaction inserted, the drop and IME backstop', () => {
    const document = doc(para('ab'));
    const state = EditorState.create({ schema, doc: document, plugins: [controlCharGuard()] });
    const next = state.apply(state.tr.insertText('x\u0001y', caretAt(2)));
    expect(next.doc.textContent).toBe('abxy');
  });

  it('keeps tab and newline', () => {
    const document = doc(para('ab'));
    const state = EditorState.create({ schema, doc: document, plugins: [controlCharGuard()] });
    const next = state.apply(state.tr.insertText('\tc\nd', caretAt(2)));
    expect(next.doc.textContent).toBe('ab\tc\nd');
  });

  it('leaves ordinary edits alone', () => {
    const document = doc(para('ab'));
    const state = EditorState.create({ schema, doc: document, plugins: [controlCharGuard()] });
    const next = state.apply(state.tr.insertText('cd', caretAt(2)));
    expect(next.doc.textContent).toBe('abcd');
  });

  it('does not loop: the appended fix-up transaction is not itself reprocessed', () => {
    const document = doc(para('ab'));
    const state = EditorState.create({ schema, doc: document, plugins: [controlCharGuard()] });
    // A guard that retriggered on its own output would never settle.
    const next = state.apply(state.tr.insertText('x\u0001', caretAt(2)));
    expect(next.doc.textContent).toBe('abx');
  });

  it('keeps the caret right after what was typed, not thrown to the end of the run', () => {
    // A stray character earlier in the same node must not move the caret.
    const document = doc(para('X\u0001abcdefgh'));
    const initial = EditorState.create({ schema, doc: document, plugins: [controlCharGuard()] });
    // Caret at the insertion point, as a real keystroke finds it.
    const state = initial.apply(initial.tr.setSelection(TextSelection.create(initial.doc, caretAt(5))));
    // Type 'Z' between "abc" and "defgh", counting the stray character.
    const next = state.apply(state.tr.insertText('Z', caretAt(5)));
    expect(next.doc.textContent).toBe('XabcZdefgh');
    // The caret sits immediately after the 'Z', wherever the repair moved it.
    const head = (next.selection as TextSelection).head;
    expect(next.doc.textBetween(head - 1, head)).toBe('Z');
  });

  it('maps a range selection through the repair instead of collapsing it', () => {
    const document = doc(para('abc\u0001defgh'));
    const state = EditorState.create({ schema, doc: document, plugins: [controlCharGuard()] });
    // Select "def", ahead of no stray character yet.
    const selected = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 6, 9)));
    expect(selected.doc.textBetween(6, 9)).toBe('def');

    // The repair deletes a character ahead of the selection, which must map, not collapse.
    const end = Selection.atEnd(selected.doc).from;
    const next = selected.apply(selected.tr.insertText('Z', end));
    expect(next.selection.empty).toBe(false);
    expect(next.doc.textBetween(next.selection.from, next.selection.to)).toBe('def');
  });

  it('leaves marks on the rest of the run untouched by the repair', () => {
    // Only the stray position is deleted, so the marked text around it is not rebuilt.
    const marked = schema.text('bo\u0001ld', [schema.marks.strong.create()]);
    const document = doc(schema.nodes.paragraph.create(null, schema.nodes.line.create(null, marked)));
    const state = EditorState.create({ schema, doc: document, plugins: [controlCharGuard()] });
    const next = state.apply(state.tr.insertText('!', caretAt(5)));
    expect(next.doc.textContent).toBe('bold!');
    let everyTextMarked = true;
    next.doc.descendants((node) => {
      if (node.isText && !node.marks.some((m) => m.type.name === 'strong')) everyTextMarked = false;
      return true;
    });
    expect(everyTextMarked).toBe(true);
  });

  it('does not throw the caret on the first keystroke in a note that already holds a stored control character', () => {
    // A stray character already stored, as in a note loaded from disk.
    const document = doc(para('ab\u0001cdefgh'));
    const initial = EditorState.create({ schema, doc: document, plugins: [controlCharGuard()] });
    const state = initial.apply(initial.tr.setSelection(TextSelection.create(initial.doc, caretAt(7))));
    const next = state.apply(state.tr.insertText('X', caretAt(7)));
    const head = (next.selection as TextSelection).head;
    expect(next.doc.textBetween(head - 1, head)).toBe('X');
  });

  it('does not delete a real character twice when one transaction touches the same text node in two places', () => {
    // Two ranges over one node must not delete the same position twice.
    const document = doc(para('abcdefghijklmnop'));
    const state = EditorState.create({ schema, doc: document, plugins: [controlCharGuard()] });
    let tr = state.tr.insertText('\u0001', caretAt(3));
    tr = tr.insertText('X', tr.mapping.map(caretAt(14)));
    const next = state.apply(tr);
    expect(next.doc.textContent).toBe('abcdefghijklmnXop');
  });

  it('does not double-delete when two ranges in one transaction both touch the same control character', () => {
    // The same dedupe with two stray characters in one node.
    const document = doc(para('a\u0001bcdefghi\u0001jk'));
    const state = EditorState.create({ schema, doc: document, plugins: [controlCharGuard()] });
    let tr = state.tr.insertText('Y', caretAt(3));
    tr = tr.insertText('Z', tr.mapping.map(caretAt(12)));
    const next = state.apply(tr);
    expect(next.doc.textContent).toBe('abYcdefghijZk');
  });

  it('cleans a control character in each of two different text nodes touched by one transaction', () => {
    // Two text nodes, each cleaned without disturbing the other's positions.
    const plain = schema.text('ab\u0001c', []);
    const marked = schema.text('de\u0001f', [schema.marks.strong.create()]);
    const document = doc(schema.nodes.paragraph.create(null, schema.nodes.line.create(null, [plain, marked])));
    const state = EditorState.create({ schema, doc: document, plugins: [controlCharGuard()] });
    // Positions inside "abXcdeXf": plain node is abs 2-6, marked node 6-10.
    let tr = state.tr.insertText('Y', 4);
    tr = tr.insertText('Z', tr.mapping.map(8));
    const next = state.apply(tr);
    expect(next.doc.textContent).toBe('abYcdeZf');
  });
});
