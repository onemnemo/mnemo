// @vitest-environment node
/**
 * Structural keys and paste inside a table cell.
 *
 * A cell is deliberately not a container (its line holds the caret and the text),
 * but that means the generic block commands treated it as an ordinary block and
 * inserted or re-typed a sibling block at the row level, which the row cannot
 * hold. Enter and paste tore the isolating table open; Backspace at column 0 threw.
 * These lock in the guard that keeps every one of them inside the cell.
 */

import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection, type Command } from 'prosemirror-state';
import { Fragment, Slice, type Node as PMNode } from 'prosemirror-model';

import { createEditorSchema } from '../schema';
import { invariantPipeline } from '../pipeline/invariants';
import { backspaceStructural, splitBlock } from '../commands/structure';
import { placeBlockRun } from '../../clipboard/place-blocks';
import { cellCaretPos, rowCells, tableRows } from './model';

const { schema, registry } = createEditorSchema();

// --- doc builders -----------------------------------------------------------

function line(text?: string): PMNode {
  return schema.nodes.line.create(null, text ? schema.text(text) : null);
}
function para(text?: string): PMNode {
  return schema.nodes.paragraph.create(null, line(text));
}
function heading(level: number, text?: string): PMNode {
  return schema.nodes.heading.create({ level }, line(text));
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

/** The cell at (row, col) of the first top-level table. */
function cellAt(document: PMNode, row: number, col: number): PMNode {
  return rowCells(tableRows(document.child(0))[row])[col];
}

/** Applies `command` to a state built from `document` with the caret at `from`. */
function run(
  document: PMNode,
  command: Command,
  from: number,
  plugins = false,
): { state: EditorState; handled: boolean } {
  const state = EditorState.create({
    schema,
    doc: document,
    selection: TextSelection.create(document, from),
    plugins: plugins ? [invariantPipeline(registry)] : [],
  });
  let next = state;
  const handled = command(state, (tr) => {
    next = state.apply(tr);
  });
  return { state: next, handled };
}

// --- Enter ------------------------------------------------------------------

describe('Enter in a table cell', () => {
  it('inserts a line break inside the cell instead of splitting the table', () => {
    const t = table(tableRow(cell('abc'), cell('def')), tableRow(cell('ghi'), cell('jkl')));
    const { state, handled } = run(doc(t), splitBlock, cellCaretPos(t, 0, 0, 0, 'end')!, true);

    expect(handled).toBe(true);
    // Still exactly one table, no ejected paragraph, no second table.
    expect(state.doc.childCount).toBe(1);
    expect(state.doc.child(0).type.name).toBe('table');
    // The cell stays a single line (no nested block) and now carries the break.
    const edited = cellAt(state.doc, 0, 0);
    expect(edited.childCount).toBe(1);
    expect(edited.firstChild?.type.name).toBe('line');
    expect(edited.textContent).toBe('abc\n');
    // The neighbours are untouched.
    expect(cellAt(state.doc, 0, 1).textContent).toBe('def');
    expect(cellAt(state.doc, 1, 0).textContent).toBe('ghi');
  });

  it('at the start of a cell breaks in place without spawning a table or paragraph', () => {
    const t = table(tableRow(cell('abc'), cell('def')), tableRow(cell('ghi'), cell('jkl')));
    const { state, handled } = run(doc(t), splitBlock, cellCaretPos(t, 0, 0, 0, 'start')!, true);

    expect(handled).toBe(true);
    expect(state.doc.childCount).toBe(1);
    expect(state.doc.child(0).type.name).toBe('table');
    expect(cellAt(state.doc, 0, 0).textContent).toBe('\nabc');
  });
});

// --- Backspace --------------------------------------------------------------

describe('Backspace at the start of a table cell', () => {
  it('does nothing structural rather than throwing', () => {
    const t = table(tableRow(cell('abc'), cell('def')), tableRow(cell('ghi'), cell('jkl')));
    const document = doc(para('before'), t);
    // The table is the second top block, so it starts past the paragraph.
    const tablePos = document.child(0).nodeSize;
    const { state, handled } = run(document, backspaceStructural, cellCaretPos(t, tablePos, 0, 0, 'start')!);

    // Claimed (so the row is not deleted / the cell not de-formatted) and unchanged.
    expect(handled).toBe(true);
    expect(state.doc.eq(document)).toBe(true);
  });

  it('does nothing structural in an empty cell either', () => {
    const t = table(tableRow(cell(), cell('x')), tableRow(cell('y'), cell('z')));
    const document = doc(t);
    const { state, handled } = run(document, backspaceStructural, cellCaretPos(t, 0, 0, 0, 'start')!);

    expect(handled).toBe(true);
    expect(state.doc.eq(document)).toBe(true);
  });

  it('leaves an ordinary mid-cell Backspace to the default handler', () => {
    const t = table(tableRow(cell('abc'), cell('def')), tableRow(cell('ghi'), cell('jkl')));
    const document = doc(t);
    // Caret after 'a', offset 1: not column 0, so the structural command declines.
    const { handled } = run(document, backspaceStructural, cellCaretPos(t, 0, 0, 0, 'start')! + 1);

    expect(handled).toBe(false);
  });
});

// --- Paste ------------------------------------------------------------------

describe('Pasting a block run into a table cell', () => {
  it('folds a multi-block run into the cell line, joined by breaks, without splitting the table', () => {
    const t = table(tableRow(cell('hello'), cell('world')), tableRow(cell('a'), cell('b')));
    const document = doc(t, para('tail'));
    const from = cellCaretPos(t, 0, 0, 0, 'end')!;
    const state = EditorState.create({
      schema,
      doc: document,
      selection: TextSelection.create(document, from),
    });
    const run2 = new Slice(Fragment.fromArray([para('L1'), para('L2')]), 0, 0);
    const next = state.apply(placeBlockRun(state, run2));

    // The document keeps its shape: one table then the tail paragraph, and nothing
    // was ejected to the top level between them.
    expect(next.doc.childCount).toBe(2);
    expect(next.doc.child(0).type.name).toBe('table');
    expect(next.doc.child(1).type.name).toBe('paragraph');
    expect(next.doc.child(1).textContent).toBe('tail');
    // The table still has its two rows, not split into two tables.
    expect(tableRows(next.doc.child(0)).length).toBe(2);
    // The paste folded into the cell's single line as inline text, a break where
    // the block boundary was, with no nested block.
    const edited = cellAt(next.doc, 0, 0);
    expect(edited.childCount).toBe(1);
    expect(edited.firstChild?.type.name).toBe('line');
    expect(edited.textContent).toBe('helloL1\nL2');
  });

  it('folds a single non-Text block into the cell as plain inline text', () => {
    const t = table(tableRow(cell('x'), cell('y')));
    const document = doc(t);
    const from = cellCaretPos(t, 0, 0, 0, 'end')!;
    const state = EditorState.create({
      schema,
      doc: document,
      selection: TextSelection.create(document, from),
    });
    const slice = new Slice(Fragment.fromArray([heading(1, 'Title')]), 0, 0);
    const next = state.apply(placeBlockRun(state, slice));

    expect(next.doc.childCount).toBe(1);
    const edited = cellAt(next.doc, 0, 0);
    expect(edited.childCount).toBe(1);
    expect(edited.firstChild?.type.name).toBe('line');
    expect(edited.textContent).toBe('xTitle');
  });
});
