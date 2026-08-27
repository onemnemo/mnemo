// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { EditorState, NodeSelection, TextSelection, type Command, type Transaction } from 'prosemirror-state';
import { keydownHandler } from 'prosemirror-keymap';
import type { Mark, Node as PMNode } from 'prosemirror-model';

import { createEditorSchema } from '../schema';
import { invariantPipeline } from '../pipeline/invariants';
import {
  backspaceStructural,
  convertBlockType,
  deleteForwardStructural,
  insertSoftBreak,
  splitBlock,
  structureKeyBindings,
} from './structure';

const { schema, registry } = createEditorSchema();
const strong = schema.marks.strong.create();

// --- doc builders -----------------------------------------------------------

function line(text?: string, marks?: readonly Mark[]): PMNode {
  return schema.nodes.line.create(null, text ? schema.text(text, marks) : null);
}
function codeLine(text?: string): PMNode {
  return schema.nodes.codeLine.create(null, text ? schema.text(text) : null);
}
function para(text?: string, attrs?: Record<string, unknown>, marks?: readonly Mark[]): PMNode {
  return schema.nodes.paragraph.create(attrs ?? null, line(text, marks));
}
function heading(level: number, text?: string, attrs?: Record<string, unknown>, marks?: readonly Mark[]): PMNode {
  return schema.nodes.heading.create({ level, ...(attrs ?? {}) }, line(text, marks));
}
function quote(text?: string, attrs?: Record<string, unknown>): PMNode {
  return schema.nodes.quote.create(attrs ?? null, line(text));
}
function bullet(text?: string, attrs?: Record<string, unknown>): PMNode {
  return schema.nodes.bulletItem.create(attrs ?? null, line(text));
}
function code(text?: string, attrs?: Record<string, unknown>): PMNode {
  return schema.nodes.codeBlock.create(attrs ?? null, codeLine(text));
}
function divider(): PMNode {
  return schema.nodes.divider.create(null, line());
}
function cell(text?: string): PMNode {
  return schema.nodes.tableCell.create(null, line(text));
}
function tableRow(...cells: PMNode[]): PMNode {
  return schema.nodes.tableRow.create(null, [line(), ...cells]);
}
function table(...rows: PMNode[]): PMNode {
  return schema.nodes.table.create({ columnWidths: [] }, [line(), ...rows]);
}
function doc(...blocks: PMNode[]): PMNode {
  return schema.nodes.doc.create(null, blocks);
}

// --- harness ----------------------------------------------------------------

/** Absolute position of `offset` inside the line of the `blockIndex`-th top block. */
function caretAt(document: PMNode, blockIndex: number, offset: number): number {
  let start = -1;
  document.forEach((_node, off, index) => {
    if (index === blockIndex) start = off;
  });
  return start + 2 + offset;
}

interface RunOptions {
  readonly plugins?: boolean;
  readonly from: number;
  readonly to?: number;
}

/** Applies `command` to a state built from `document`, returning the new state. */
function run(document: PMNode, command: Command, opts: RunOptions): { state: EditorState; handled: boolean } {
  const selection = TextSelection.create(document, opts.from, opts.to ?? opts.from);
  const state = EditorState.create({
    schema,
    doc: document,
    selection,
    plugins: opts.plugins ? [invariantPipeline(registry)] : [],
  });
  let next = state;
  const handled = command(state, (tr) => {
    next = state.apply(tr);
  });
  return { state: next, handled };
}

/** Whether every text run in a block's line carries `markName`. */
function allBold(block: PMNode): boolean {
  const lineNode = block.firstChild;
  if (!lineNode || lineNode.content.size === 0) return false;
  let all = true;
  lineNode.forEach((child) => {
    if (child.isText && !child.marks.some((m) => m.type === schema.marks.strong)) all = false;
  });
  return all;
}

// --- Enter / split ----------------------------------------------------------

describe('splitBlock (Enter)', () => {
  it('splits a paragraph at the caret, current keeps its text, new block gets the rest', () => {
    const { state } = run(doc(para('hello')), splitBlock, { from: caretAt(doc(para('hello')), 0, 2) });
    expect(state.doc.childCount).toBe(2);
    expect(state.doc.child(0).type.name).toBe('paragraph');
    expect(state.doc.child(0).textContent).toBe('he');
    expect(state.doc.child(1).type.name).toBe('paragraph');
    expect(state.doc.child(1).textContent).toBe('llo');
    // Caret lands at the start of the new block's line content.
    expect(state.selection.from).toBe(caretAt(state.doc, 1, 0));
  });

  it('at the end of a paragraph inserts an empty Text block below', () => {
    const document = doc(para('done'));
    const { state } = run(document, splitBlock, { from: caretAt(document, 0, 4) });
    expect(state.doc.childCount).toBe(2);
    expect(state.doc.child(1).type.name).toBe('paragraph');
    expect(state.doc.child(1).textContent).toBe('');
  });

  it('at the logical start of a non-empty block pushes an empty Text block above', () => {
    const document = doc(heading(1, 'Title'));
    const { state } = run(document, splitBlock, { from: caretAt(document, 0, 0) });
    expect(state.doc.childCount).toBe(2);
    expect(state.doc.child(0).type.name).toBe('paragraph');
    expect(state.doc.child(0).textContent).toBe('');
    // The heading is untouched below, and the caret stays with it.
    expect(state.doc.child(1).type.name).toBe('heading');
    expect(state.doc.child(1).textContent).toBe('Title');
    expect(state.selection.from).toBe(caretAt(state.doc, 1, 0));
  });

  it('splits a bold run keeping the mark on both halves', () => {
    const document = doc(para('ab', undefined, [strong]));
    const { state } = run(document, splitBlock, { from: caretAt(document, 0, 1) });
    expect(state.doc.child(0).textContent).toBe('a');
    expect(state.doc.child(1).textContent).toBe('b');
    expect(allBold(state.doc.child(0))).toBe(true);
    expect(allBold(state.doc.child(1))).toBe(true);
  });

  it('inside a code block inserts a literal newline instead of splitting', () => {
    const document = doc(code('ab'));
    const { state } = run(document, splitBlock, { from: caretAt(document, 0, 1) });
    expect(state.doc.childCount).toBe(1);
    expect(state.doc.child(0).type.name).toBe('codeBlock');
    expect(state.doc.child(0).textContent).toBe('a\nb');
  });

  it('in an empty list item converts to Text and leaves the list', () => {
    const document = doc(bullet('', { id: 'g1', sid: 'ab12c' }));
    const { state } = run(document, splitBlock, { from: caretAt(document, 0, 0) });
    expect(state.doc.childCount).toBe(1);
    const block = state.doc.child(0);
    expect(block.type.name).toBe('paragraph');
    // Identity survives the type change.
    expect(block.attrs.id).toBe('g1');
    expect(block.attrs.sid).toBe('ab12c');
  });

  it('in a non-empty list item splits into a same-type sibling', () => {
    const document = doc(bullet('milk'));
    const { state } = run(document, splitBlock, { from: caretAt(document, 0, 2) });
    expect(state.doc.childCount).toBe(2);
    expect(state.doc.child(0).type.name).toBe('bulletItem');
    expect(state.doc.child(0).textContent).toBe('mi');
    expect(state.doc.child(1).type.name).toBe('bulletItem');
    expect(state.doc.child(1).textContent).toBe('lk');
    // The fresh sibling carries no identity, the server mints it on commit.
    expect(state.doc.child(1).attrs.sid).toBe('');
  });

  it('in a quote on a non-empty line inserts a soft newline, staying one block', () => {
    const document = doc(quote('hi'));
    const { state } = run(document, splitBlock, { from: caretAt(document, 0, 2) });
    expect(state.doc.childCount).toBe(1);
    expect(state.doc.child(0).type.name).toBe('quote');
    expect(state.doc.child(0).textContent).toBe('hi\n');
  });

  it('in a quote on a blank line exits to a Text block below', () => {
    const document = doc(quote('hi\n'));
    const { state } = run(document, splitBlock, { from: caretAt(document, 0, 3) });
    expect(state.doc.childCount).toBe(2);
    expect(state.doc.child(0).type.name).toBe('quote');
    expect(state.doc.child(0).textContent).toBe('hi');
    expect(state.doc.child(1).type.name).toBe('paragraph');
    expect(state.doc.child(1).textContent).toBe('');
  });

  it('keeps a split heading bold and drops the tail into a plain Text block', () => {
    const document = doc(heading(2, 'Title', undefined, [strong]));
    const { state } = run(document, splitBlock, { from: caretAt(document, 0, 2), plugins: true });
    expect(state.doc.child(0).type.name).toBe('heading');
    expect(state.doc.child(0).textContent).toBe('Ti');
    expect(allBold(state.doc.child(0))).toBe(true);
    expect(state.doc.child(1).type.name).toBe('paragraph');
    expect(state.doc.child(1).textContent).toBe('tle');
  });
});

describe('insertSoftBreak (Shift-Enter, Mod-Enter)', () => {
  it('inserts a newline at the caret without splitting', () => {
    const document = doc(para('ab'));
    const { state } = run(document, insertSoftBreak, { from: caretAt(document, 0, 1) });
    expect(state.doc.childCount).toBe(1);
    expect(state.doc.child(0).textContent).toBe('a\nb');
  });

  it('answers both chords, and Enter stays a split', () => {
    const bindings = structureKeyBindings();
    expect(bindings['Shift-Enter']).toBe(insertSoftBreak);
    expect(bindings['Mod-Enter']).toBe(insertSoftBreak);
    expect(bindings.Enter).toBe(splitBlock);
  });

  it('replaces a selected range with the newline', () => {
    const document = doc(para('quote text'));
    const { state } = run(document, insertSoftBreak, {
      from: caretAt(document, 0, 5),
      to: caretAt(document, 0, 6),
    });
    expect(state.doc.childCount).toBe(1);
    expect(state.doc.child(0).textContent).toBe('quote\ntext');
  });

  it('declines a node selection rather than replacing the node', () => {
    const document = doc(para('ab'), divider());
    const state = EditorState.create({
      schema,
      doc: document,
      selection: NodeSelection.create(document, document.child(0).nodeSize),
    });
    let dispatched = false;
    const handled = insertSoftBreak(state, () => {
      dispatched = true;
    });
    expect(handled).toBe(false);
    expect(dispatched).toBe(false);
  });

  it('reaches the command from the real chord, through keymap normalization', () => {
    const document = doc(para('ab'));
    const state = EditorState.create({
      schema,
      doc: document,
      selection: TextSelection.create(document, caretAt(document, 0, 1)),
    });
    let applied = state;
    const view = {
      state,
      dispatch: (tr: Transaction) => {
        applied = state.apply(tr);
      },
    };
    const press = { key: 'Enter', keyCode: 13, shiftKey: true, altKey: false, ctrlKey: false, metaKey: false };
    const handled = keydownHandler(structureKeyBindings())(view as never, press as unknown as KeyboardEvent);
    expect(handled).toBe(true);
    expect(applied.doc.child(0).textContent).toBe('a\nb');
  });
});

// --- Backspace --------------------------------------------------------------

describe('backspaceStructural (Backspace at column 0)', () => {
  it('does nothing when the caret is not at the line start', () => {
    const document = doc(para('ab'));
    const { handled } = run(document, backspaceStructural, { from: caretAt(document, 0, 1) });
    expect(handled).toBe(false);
  });

  it('deletes an empty Text block and focuses the end of the previous one', () => {
    const document = doc(para('above'), para(''));
    const { state } = run(document, backspaceStructural, { from: caretAt(document, 1, 0) });
    expect(state.doc.childCount).toBe(1);
    expect(state.doc.child(0).textContent).toBe('above');
    expect(state.selection.from).toBe(caretAt(state.doc, 0, 5));
  });

  it('never deletes the last remaining block', () => {
    const document = doc(para(''));
    const { state, handled } = run(document, backspaceStructural, { from: caretAt(document, 0, 0) });
    expect(handled).toBe(true);
    expect(state.doc.childCount).toBe(1);
  });

  it('de-formats an empty heading to Text, preserving identity', () => {
    const document = doc(para('x'), heading(1, '', { id: 'g2', sid: 'zz99y' }));
    const { state } = run(document, backspaceStructural, { from: caretAt(document, 1, 0) });
    const block = state.doc.child(1);
    expect(block.type.name).toBe('paragraph');
    expect(block.attrs.id).toBe('g2');
    expect(block.attrs.sid).toBe('zz99y');
  });

  it('de-formats a non-empty heading to Text, keeping content and stripping bold, no merge', () => {
    const document = doc(para('x'), heading(1, 'Head', undefined, [strong]));
    const { state } = run(document, backspaceStructural, { from: caretAt(document, 1, 0) });
    expect(state.doc.childCount).toBe(2);
    const block = state.doc.child(1);
    expect(block.type.name).toBe('paragraph');
    expect(block.textContent).toBe('Head');
    expect(allBold(block)).toBe(false);
  });

  it('merges a non-empty Text block into the previous block, which keeps its type', () => {
    const document = doc(para('foo'), para('bar'));
    const { state } = run(document, backspaceStructural, { from: caretAt(document, 1, 0) });
    expect(state.doc.childCount).toBe(1);
    expect(state.doc.child(0).textContent).toBe('foobar');
    // Caret at the join, the previous block's old end.
    expect(state.selection.from).toBe(caretAt(state.doc, 0, 3));
  });

  it('merging a Text block into a heading above re-bolds the appended text', () => {
    const document = doc(heading(1, 'AB', undefined, [strong]), para('cd'));
    const { state } = run(document, backspaceStructural, { from: caretAt(document, 1, 0), plugins: true });
    expect(state.doc.childCount).toBe(1);
    const block = state.doc.child(0);
    expect(block.type.name).toBe('heading');
    expect(block.textContent).toBe('ABcd');
    expect(allBold(block)).toBe(true);
  });

  it('at the first block with content does nothing (no previous to merge into)', () => {
    const document = doc(para('only'));
    const { state, handled } = run(document, backspaceStructural, { from: caretAt(document, 0, 0) });
    expect(handled).toBe(true);
    expect(state.doc.childCount).toBe(1);
    expect(state.doc.child(0).textContent).toBe('only');
  });

  it('swallows the key rather than merge text into a divider, which has no line to hold it', () => {
    const document = doc(divider(), para('hello'));
    const { state, handled } = run(document, backspaceStructural, { from: caretAt(document, 1, 0) });
    expect(handled).toBe(true);
    expect(state.doc.eq(document)).toBe(true);
  });

  it('swallows the key rather than merge text into a table, whose own line is hidden scenery', () => {
    const t = table(tableRow(cell('a'), cell('b')));
    const document = doc(t, para('hello'));
    const { state, handled } = run(document, backspaceStructural, { from: caretAt(document, 1, 0) });
    expect(handled).toBe(true);
    expect(state.doc.eq(document)).toBe(true);
  });

  it('swallows the key rather than strand the caret deleting an empty block after a divider', () => {
    const document = doc(divider(), para(''));
    const { state, handled } = run(document, backspaceStructural, { from: caretAt(document, 1, 0) });
    expect(handled).toBe(true);
    // Nothing moved: the empty paragraph was not deleted, because doing so
    // would have left the caret with nowhere visible to land.
    expect(state.doc.eq(document)).toBe(true);
  });

  it('swallows the key rather than strand the caret deleting an empty block after a table', () => {
    const t = table(tableRow(cell('a')));
    const document = doc(t, para(''));
    const { state, handled } = run(document, backspaceStructural, { from: caretAt(document, 1, 0) });
    expect(handled).toBe(true);
    expect(state.doc.eq(document)).toBe(true);
  });
});

// --- Delete -------------------------------------------------------------

describe('deleteForwardStructural (Delete at the end of a line)', () => {
  it('does nothing when the caret is not at the line end', () => {
    const document = doc(para('ab'));
    const { handled } = run(document, deleteForwardStructural, { from: caretAt(document, 0, 1) });
    expect(handled).toBe(false);
  });

  it('does nothing at the end of the last block (nothing to join with)', () => {
    const document = doc(para('only'));
    const { state, handled } = run(document, deleteForwardStructural, {
      from: caretAt(document, 0, 'only'.length),
    });
    expect(handled).toBe(true);
    expect(state.doc.eq(document)).toBe(true);
  });

  it('merges a following non-empty Text block in, current block keeps its type', () => {
    const document = doc(para('foo'), para('bar'));
    const { state } = run(document, deleteForwardStructural, { from: caretAt(document, 0, 3) });
    expect(state.doc.childCount).toBe(1);
    expect(state.doc.child(0).type.name).toBe('paragraph');
    expect(state.doc.child(0).textContent).toBe('foobar');
    // Caret stays at the join point, where it already was.
    expect(state.selection.from).toBe(caretAt(state.doc, 0, 3));
  });

  it('merging into a heading keeps the heading and re-bolds the appended text', () => {
    const document = doc(heading(1, 'AB', undefined, [strong]), para('cd'));
    const { state } = run(document, deleteForwardStructural, {
      from: caretAt(document, 0, 2),
      plugins: true,
    });
    expect(state.doc.childCount).toBe(1);
    const block = state.doc.child(0);
    expect(block.type.name).toBe('heading');
    expect(block.textContent).toBe('ABcd');
    expect(allBold(block)).toBe(true);
  });

  it('a code block strips marks from the merged-in text', () => {
    const document = doc(code('ab'), para('cd'));
    const { state } = run(document, deleteForwardStructural, { from: caretAt(document, 0, 2) });
    expect(state.doc.childCount).toBe(1);
    expect(state.doc.child(0).type.name).toBe('codeBlock');
    expect(state.doc.child(0).textContent).toBe('abcd');
  });

  it('removes a following empty Text block, caret stays where it was', () => {
    const document = doc(para('abc'), para(''));
    const { state } = run(document, deleteForwardStructural, { from: caretAt(document, 0, 3) });
    expect(state.doc.childCount).toBe(1);
    expect(state.doc.child(0).textContent).toBe('abc');
    expect(state.selection.from).toBe(caretAt(state.doc, 0, 3));
  });

  it('swallows rather than nest a following non-Text block into this one', () => {
    const document = doc(para('ab'), heading(1, 'Head'));
    const { state, handled } = run(document, deleteForwardStructural, { from: caretAt(document, 0, 2) });
    expect(handled).toBe(true);
    // Unchanged: still two top-level blocks, the heading never became a
    // child of the paragraph. This is the bug ProseMirror's own `Delete`
    // binding produced (joinForward re-parents instead of merging).
    expect(state.doc.eq(document)).toBe(true);
    expect(state.doc.childCount).toBe(2);
    expect(state.doc.child(1).type.name).toBe('heading');
    expect(state.doc.child(1).textContent).toBe('Head');
  });

  it('swallows rather than absorb a following divider', () => {
    const document = doc(para('ab'), divider());
    const { state, handled } = run(document, deleteForwardStructural, { from: caretAt(document, 0, 2) });
    expect(handled).toBe(true);
    expect(state.doc.eq(document)).toBe(true);
  });

  it('swallows rather than absorb a following table', () => {
    const t = table(tableRow(cell('a'), cell('b')));
    const document = doc(para('ab'), t);
    const { state, handled } = run(document, deleteForwardStructural, { from: caretAt(document, 0, 2) });
    expect(handled).toBe(true);
    expect(state.doc.eq(document)).toBe(true);
  });

  it('is a safe no-op at the end of a table cell, never joining across the row', () => {
    const t = table(tableRow(cell('abc'), cell('def')));
    const document = doc(t);
    // Position at the end of the first cell's line content: past the doc, the
    // table's own line, the row's own line, and into the cell's line.
    const tableLine = schema.nodes.line.create().nodeSize;
    const from = 1 + tableLine + 1 + tableLine + 2 + 'abc'.length;
    const { state, handled } = run(document, deleteForwardStructural, { from });
    expect(handled).toBe(true);
    expect(state.doc.eq(document)).toBe(true);
  });
});

// --- convertBlockType -------------------------------------------------------

describe('convertBlockType', () => {
  it('preserves id, sid, order and meta across a type change', () => {
    const document = doc(heading(1, 'Hi', { id: 'g3', sid: 'qq00w', order: 7, meta: { k: 1 } }));
    const state = EditorState.create({ schema, doc: document });
    const tr = convertBlockType(state.tr, 0, document.child(0), schema.nodes.paragraph);
    const block = tr.doc.child(0);
    expect(block.type.name).toBe('paragraph');
    expect(block.attrs.id).toBe('g3');
    expect(block.attrs.sid).toBe('qq00w');
    expect(block.attrs.order).toBe(7);
    expect(block.attrs.meta).toEqual({ k: 1 });
  });

  it('rebuilds across a line-kind change (paragraph to code), preserving text', () => {
    const document = doc(para('x = 1', { sid: 'cc11d' }));
    const state = EditorState.create({ schema, doc: document });
    const tr = convertBlockType(state.tr, 0, document.child(0), schema.nodes.codeBlock);
    const block = tr.doc.child(0);
    expect(block.type.name).toBe('codeBlock');
    expect(block.firstChild!.type.name).toBe('codeLine');
    expect(block.textContent).toBe('x = 1');
    expect(block.attrs.sid).toBe('cc11d');
  });
});

// --- image backspace ladder ---------------------------------------------------

function image(attrs?: Record<string, unknown>, caption?: string): PMNode {
  return schema.nodes.image.create({ path: '', ...(attrs ?? {}) }, line(caption));
}

describe('backspace at an image caption start', () => {
  it('swallows the key on an image holding a picture, which never merges or de-formats', () => {
    const d = doc(para('above'), image({ path: 'aaaa.png', width: 320 }, 'caption'));
    const { state, handled } = run(d, backspaceStructural, { from: caretAt(d, 1, 0) });
    expect(handled).toBe(true);
    const block = state.doc.child(1);
    expect(block.type.name).toBe('image');
    expect(block.attrs.path).toBe('aaaa.png');
    expect(block.attrs.width).toBe(320);
    expect(block.firstChild!.textContent).toBe('caption');
  });

  it('swallows the key on a pathless image whose caption has text', () => {
    const d = doc(para('above'), image({}, 'caption'));
    const { state, handled } = run(d, backspaceStructural, { from: caretAt(d, 1, 0) });
    expect(handled).toBe(true);
    expect(state.doc.child(1).type.name).toBe('image');
  });

  it('deletes an empty placeholder in one step, focusing the block above', () => {
    const d = doc(para('above'), image({}));
    const { state, handled } = run(d, backspaceStructural, { from: caretAt(d, 1, 0) });
    expect(handled).toBe(true);
    expect(state.doc.childCount).toBe(1);
    expect(state.doc.child(0).textContent).toBe('above');
    // Caret at the end of the previous block's line, like the empty-Text delete.
    expect(state.selection.from).toBe(caretAt(state.doc, 0, 'above'.length));
  });

  it('resets an empty placeholder to Text in place when it is the last block', () => {
    const d = doc(image({}));
    const { state, handled } = run(d, backspaceStructural, { from: caretAt(d, 0, 0) });
    expect(handled).toBe(true);
    expect(state.doc.childCount).toBe(1);
    expect(state.doc.child(0).type.name).toBe('paragraph');
  });
});
