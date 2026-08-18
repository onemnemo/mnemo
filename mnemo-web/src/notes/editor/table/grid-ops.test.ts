// @vitest-environment node
/**
 * The pure grid transforms behind cell copy and paste: reading a rectangle out,
 * writing a grid in (growing the table to fit), and building a table from a grid.
 */

import { describe, expect, it } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';

import { createEditorSchema } from '../schema';
import { createTable, gridToTable, readRectText, rowCells, tableRows, writeCells } from './model';

const { schema } = createEditorSchema();

function line(text?: string): PMNode {
  return schema.nodes.line.create(null, text ? schema.text(text) : null);
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

/** The text of every cell, row by row. */
function textGrid(t: PMNode): string[][] {
  return tableRows(t).map((row) => rowCells(row).map((c) => c.textContent));
}

describe('readRectText', () => {
  it('reads a rectangle of cells row by row', () => {
    const t = table(tableRow(cell('a'), cell('b'), cell('c')), tableRow(cell('d'), cell('e'), cell('f')));
    expect(readRectText(t, { r0: 0, c0: 1, r1: 1, c1: 2 })).toEqual([
      ['b', 'c'],
      ['e', 'f'],
    ]);
  });

  it('normalizes a rectangle dragged bottom-right to top-left', () => {
    const t = table(tableRow(cell('a'), cell('b')), tableRow(cell('c'), cell('d')));
    expect(readRectText(t, { r0: 1, c0: 1, r1: 0, c1: 0 })).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });
});

describe('writeCells', () => {
  it('writes a grid into existing cells, keeping the ones outside it', () => {
    const t = table(tableRow(cell('a'), cell('b')), tableRow(cell('c'), cell('d')));
    const out = writeCells(t, { row: 0, col: 1 }, [['X'], ['Y']]);
    expect(textGrid(out)).toEqual([
      ['a', 'X'],
      ['c', 'Y'],
    ]);
  });

  it('grows the table with empty rows and columns to hold an overflowing grid', () => {
    const t = createTable(schema, 2, 2);
    const out = writeCells(t, { row: 1, col: 1 }, [
      ['p', 'q'],
      ['r', 's'],
    ]);
    expect(tableRows(out).length).toBe(3);
    expect(readRectText(out, { r0: 0, c0: 0, r1: 2, c1: 2 })).toEqual([
      ['', '', ''],
      ['', 'p', 'q'],
      ['', 'r', 's'],
    ]);
  });

  it('keeps a cell fill when its text is overwritten', () => {
    const filled = schema.nodes.tableCell.create({ fill: 'blue' }, line('old'));
    const t = table(tableRow(filled, cell('b')));
    const out = writeCells(t, { row: 0, col: 0 }, [['new']]);
    const written = rowCells(tableRows(out)[0])[0];
    expect(written.textContent).toBe('new');
    expect(written.attrs.fill).toBe('blue');
  });

  it('leaves cells past a ragged grid row untouched', () => {
    const t = table(tableRow(cell('a'), cell('b')), tableRow(cell('c'), cell('d')));
    const out = writeCells(t, { row: 0, col: 0 }, [['X'], ['Y', 'Z']]);
    expect(textGrid(out)).toEqual([
      ['X', 'b'],
      ['Y', 'Z'],
    ]);
  });
});

describe('gridToTable', () => {
  it('builds a table padded to the widest row', () => {
    const out = gridToTable(schema, [['a', 'b', 'c'], ['d', 'e']]);
    expect(out.type.name).toBe('table');
    expect(tableRows(out).length).toBe(2);
    expect(textGrid(out)).toEqual([
      ['a', 'b', 'c'],
      ['d', 'e', ''],
    ]);
  });
});
