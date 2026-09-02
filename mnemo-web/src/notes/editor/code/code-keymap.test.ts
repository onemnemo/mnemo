// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection, type Command } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';

import { createEditorSchema } from '../schema';
import { codeKeyBindings, indentCodeLine, outdentCodeLine } from './code-keymap';

const { schema } = createEditorSchema();

// --- builders ---------------------------------------------------------------

function line(text?: string): PMNode {
  return schema.nodes.line.create(null, text ? schema.text(text) : null);
}
function para(text?: string): PMNode {
  return schema.nodes.paragraph.create(null, line(text));
}
function code(text: string): PMNode {
  return schema.nodes.codeBlock.create(
    { language: 'csharp' },
    schema.nodes.codeLine.create(null, schema.text(text)),
  );
}
function doc(...blocks: PMNode[]): PMNode {
  return schema.nodes.doc.create(null, blocks);
}

// --- harness ----------------------------------------------------------------

/** Absolute position of `offset` inside the line of the `blockIndex`-th top block. */
function caretAt(document: PMNode, blockIndex: number, offset: number): number {
  let start = -1;
  document.forEach((_node, at, index) => {
    if (index === blockIndex) start = at;
  });
  return start + 2 + offset;
}

function run(
  document: PMNode,
  command: Command,
  from: number,
  to = from,
): { state: EditorState; handled: boolean } {
  const state = EditorState.create({
    schema,
    doc: document,
    selection: TextSelection.create(document, from, to),
  });
  let next = state;
  const handled = command(state, (tr) => {
    next = state.apply(tr);
  });
  return { state: next, handled };
}

// --- Tab --------------------------------------------------------------------

describe('Tab inside source', () => {
  it('is what the source keymap binds Tab and Shift-Tab to', () => {
    const bindings = codeKeyBindings();
    expect(bindings.Tab).toBe(indentCodeLine);
    expect(bindings['Shift-Tab']).toBe(outdentCodeLine);
  });

  it('inserts one level of indentation at the caret', () => {
    const document = doc(code('int x;'));
    const { state, handled } = run(document, indentCodeLine, caretAt(document, 0, 0));

    expect(handled).toBe(true);
    expect(state.doc.child(0).textContent).toBe('  int x;');
    expect(state.selection.from).toBe(caretAt(state.doc, 0, 2));
  });

  it('inserts at the caret rather than at the line start, mid-line', () => {
    const document = doc(code('a b'));
    const { state } = run(document, indentCodeLine, caretAt(document, 0, 2));
    expect(state.doc.child(0).textContent).toBe('a   b');
  });

  it('indents every line a range covers, once each', () => {
    const document = doc(code('one\ntwo\nthree'));
    const { state } = run(
      document,
      indentCodeLine,
      caretAt(document, 0, 1),
      caretAt(document, 0, 'one\ntw'.length),
    );
    expect(state.doc.child(0).textContent).toBe('  one\n  two\nthree');
  });

  it('is declined outside source, where the editor has no indentation to offer', () => {
    const document = doc(para('writing'));
    expect(run(document, indentCodeLine, caretAt(document, 0, 3)).handled).toBe(false);
    expect(run(document, outdentCodeLine, caretAt(document, 0, 3)).handled).toBe(false);
  });

  it('is declined by a selection that leaves the source line', () => {
    const document = doc(para('ab'), code('cd'));
    const across = {
      from: caretAt(document, 0, 1),
      to: caretAt(document, 1, 1),
    };
    expect(run(document, indentCodeLine, across.from, across.to).handled).toBe(false);
    expect(run(document, outdentCodeLine, across.from, across.to).handled).toBe(false);
  });
});

// --- Shift+Tab ---------------------------------------------------------------

describe('Shift+Tab inside source', () => {
  it('takes one level off the front of the caret line, wherever the caret sits', () => {
    const document = doc(code('    deep'));
    const { state, handled } = run(document, outdentCodeLine, caretAt(document, 0, 6));

    expect(handled).toBe(true);
    expect(state.doc.child(0).textContent).toBe('  deep');
  });

  it('takes a leading tab character as one level too', () => {
    const document = doc(code('\tdeep'));
    const { state } = run(document, outdentCodeLine, caretAt(document, 0, 1));
    expect(state.doc.child(0).textContent).toBe('deep');
  });

  it('takes a lone leading space rather than leaving it behind', () => {
    const document = doc(code(' odd'));
    const { state } = run(document, outdentCodeLine, caretAt(document, 0, 0));
    expect(state.doc.child(0).textContent).toBe('odd');
  });

  it('claims the key with nothing to remove, so focus stays on the caret', () => {
    const document = doc(code('flush'));
    const { state, handled } = run(document, outdentCodeLine, caretAt(document, 0, 0));

    expect(handled).toBe(true);
    expect(state.doc.child(0).textContent).toBe('flush');
  });

  it('outdents every line a range covers, skipping the ones already flush', () => {
    const document = doc(code('  one\ntwo\n  three'));
    const { state } = run(
      document,
      outdentCodeLine,
      caretAt(document, 0, 0),
      caretAt(document, 0, '  one\ntwo\n  th'.length),
    );
    expect(state.doc.child(0).textContent).toBe('one\ntwo\nthree');
  });
});
