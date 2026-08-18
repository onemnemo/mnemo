// @vitest-environment jsdom
/**
 * The cell clipboard: serializing a rectangle to the grid formats a spreadsheet
 * reads, parsing those formats back, and the end to end paste that spreads a grid
 * across cells (growing the table), builds a table from a pasted HTML table, and
 * leaves ordinary tab text alone outside a table.
 */

import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';

import { createEditorSchema } from '../editor/schema';
import { invariantPipeline } from '../editor/pipeline/invariants';
import { cellCaretPos, rowCells, tableRows } from '../editor/table/model';
import { handleInternalPaste } from './paste';
import { gridToHtml, gridToTsv, isMultiCell, parseClipboardGrid } from './table-grid';

const { schema, registry } = createEditorSchema();

// --- builders ---------------------------------------------------------------

function line(text?: string): PMNode {
  return schema.nodes.line.create(null, text ? schema.text(text) : null);
}
function para(text?: string): PMNode {
  return schema.nodes.paragraph.create(null, line(text));
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

function transfer(types: Record<string, string>): DataTransfer {
  return { getData: (type: string) => types[type] ?? '' } as unknown as DataTransfer;
}

/** A minimal view whose state is reapplied on dispatch, enough for the paste path. */
function fakeView(document: PMNode, from: number): EditorView {
  const holder = {
    state: EditorState.create({
      schema,
      doc: document,
      selection: TextSelection.create(document, from),
      plugins: [invariantPipeline(registry)],
    }),
  };
  return {
    get state() {
      return holder.state;
    },
    dispatch(tr: Transaction) {
      holder.state = holder.state.apply(tr);
    },
    composing: false,
  } as unknown as EditorView;
}

function firstTable(document: PMNode): PMNode | null {
  let found: PMNode | null = null;
  document.descendants((node) => {
    if (found) return false;
    if (node.type.name === 'table') found = node;
    return !found;
  });
  return found;
}
function textGrid(t: PMNode): string[][] {
  return tableRows(t).map((row) => rowCells(row).map((c) => c.textContent));
}

// --- serialization ----------------------------------------------------------

describe('grid serialization', () => {
  it('writes tab separated text, flattening a cell break to a space', () => {
    expect(gridToTsv([['a', 'b'], ['c\nd', 'e']])).toBe('a\tb\nc d\te');
  });

  it('writes an HTML table, keeping a cell break as a <br> and escaping markup', () => {
    expect(gridToHtml([['a<b>', 'c\nd']])).toBe('<table><tbody><tr><td>a&lt;b&gt;</td><td>c<br>d</td></tr></tbody></table>');
  });

  it('counts a rectangle as multi-cell but a lone value as not', () => {
    expect(isMultiCell([['a', 'b']])).toBe(true);
    expect(isMultiCell([['a'], ['b']])).toBe(true);
    expect(isMultiCell([['a']])).toBe(false);
    expect(isMultiCell([])).toBe(false);
  });
});

describe('parseClipboardGrid', () => {
  it('reads an HTML table and flags it as from HTML', () => {
    const parsed = parseClipboardGrid(
      transfer({ 'text/html': '<table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>' }),
    );
    expect(parsed).toEqual({ grid: [['a', 'b'], ['c', 'd']], fromHtml: true });
  });

  it('reads tab separated text and flags it as not from HTML', () => {
    const parsed = parseClipboardGrid(transfer({ 'text/plain': 'a\tb\nc\td' }));
    expect(parsed).toEqual({ grid: [['a', 'b'], ['c', 'd']], fromHtml: false });
  });

  it('turns a cell <br> back into a newline', () => {
    const parsed = parseClipboardGrid(transfer({ 'text/html': '<table><tr><td>x<br>y</td></tr></table>' }));
    expect(parsed?.grid).toEqual([['x\ny']]);
  });

  it('is nothing for plain text without a tab', () => {
    expect(parseClipboardGrid(transfer({ 'text/plain': 'just words' }))).toBeNull();
  });
});

// --- paste ------------------------------------------------------------------

describe('pasting a grid', () => {
  it('spreads a tab separated grid across cells from the caret', () => {
    const t = table(tableRow(cell(), cell()), tableRow(cell(), cell()));
    const document = doc(para('before'), t);
    const tablePos = document.child(0).nodeSize;
    const view = fakeView(document, cellCaretPos(t, tablePos, 0, 0, 'start')!);

    const handled = handleInternalPaste(view, transfer({ 'text/plain': 'X\tY\nZ\tW' }), registry);

    expect(handled).toBe(true);
    expect(textGrid(firstTable(view.state.doc)!)).toEqual([
      ['X', 'Y'],
      ['Z', 'W'],
    ]);
    // Untouched blocks around the table survive.
    expect(view.state.doc.child(0).textContent).toBe('before');
  });

  it('grows the table when the grid overflows past the caret cell', () => {
    const t = table(tableRow(cell('a'), cell('b')), tableRow(cell('c'), cell('d')));
    const document = doc(t);
    const view = fakeView(document, cellCaretPos(t, 0, 1, 1, 'start')!);

    const handled = handleInternalPaste(view, transfer({ 'text/plain': 'P\tQ\nR\tS' }), registry);

    expect(handled).toBe(true);
    expect(textGrid(firstTable(view.state.doc)!)).toEqual([
      ['a', 'b', ''],
      ['c', 'P', 'Q'],
      ['', 'R', 'S'],
    ]);
  });

  it('builds a new table from an HTML table pasted outside a table', () => {
    const document = doc(para(''));
    const view = fakeView(document, 2);

    const handled = handleInternalPaste(
      view,
      transfer({ 'text/html': '<table><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></table>' }),
      registry,
    );

    expect(handled).toBe(true);
    const built = firstTable(view.state.doc);
    expect(built).not.toBeNull();
    expect(textGrid(built!)).toEqual([
      ['A', 'B'],
      ['C', 'D'],
    ]);
  });

  it('leaves tab separated text outside a table as ordinary text', () => {
    const document = doc(para(''));
    const view = fakeView(document, 2);

    handleInternalPaste(view, transfer({ 'text/plain': 'a\tb\tc' }), registry);

    // No table was conjured from plain tab text; it stayed in the paragraph.
    expect(firstTable(view.state.doc)).toBeNull();
    expect(view.state.doc.textContent).toContain('a');
  });
});
