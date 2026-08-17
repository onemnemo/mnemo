/**
 * The table's shape operations.
 *
 * Everything here is really one assertion said nine ways: after any operation the
 * table is still a rectangle, and the widths still describe the columns that
 * exist. A ragged table is not a rendering bug, it is a table whose resize handle
 * for column three sits over the text of column two, and every overlay in the
 * view indexes by column.
 */

import { describe, expect, it } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';

import { createEditorSchema } from '../schema';
import {
  TABLE_COL_W,
  TABLE_MIN_COL_W,
  cellAtPos,
  cellCaretPos,
  clearRect,
  columnCount,
  columnWidths,
  createTable,
  duplicateCol,
  duplicateRow,
  fillRect,
  insertCols,
  insertRows,
  landedAt,
  moveCol,
  moveRow,
  movesAnything,
  normalizeRect,
  removeCol,
  removeRow,
  rowCells,
  setColumnWidth,
  squareUp,
  tableRows,
  trimCols,
  trimRows,
} from './model';

const { schema } = createEditorSchema();

/** A table whose cells say where they are, so a move can be read off the text. */
function tableOf(text: string[][]): PMNode {
  const rows = text.map((row) =>
    schema.nodes.tableRow.create(null, [
      schema.nodes.line.create(),
      ...row.map((value) =>
        schema.nodes.tableCell.create(
          null,
          schema.nodes.line.create(null, value.length > 0 ? schema.text(value) : null),
        ),
      ),
    ]),
  );
  return schema.nodes.table.create(
    { columnWidths: text[0].map(() => TABLE_COL_W) },
    [schema.nodes.line.create(), ...rows],
  );
}

const grid = (table: PMNode): string[][] =>
  tableRows(table).map((row) => rowCells(row).map((cell) => cell.textContent));

/** The invariant every operation has to leave standing. */
function expectRectangular(table: PMNode): void {
  const cols = columnCount(table);
  for (const row of tableRows(table)) expect(rowCells(row).length).toBe(cols);
  expect(columnWidths(table).length).toBe(cols);
}

const sample = (): PMNode =>
  tableOf([
    ['a1', 'b1', 'c1'],
    ['a2', 'b2', 'c2'],
  ]);

describe('createTable', () => {
  it('makes a rectangle with a width per column', () => {
    const table = createTable(schema, 3, 4);
    expect(tableRows(table)).toHaveLength(3);
    expect(columnCount(table)).toBe(4);
    expectRectangular(table);
  });
});

describe('insert', () => {
  it('adds rows that match the column count', () => {
    const table = insertRows(sample(), 1, 2);
    expect(grid(table)).toEqual([
      ['a1', 'b1', 'c1'],
      ['', '', ''],
      ['', '', ''],
      ['a2', 'b2', 'c2'],
    ]);
    expectRectangular(table);
  });

  it('adds a column to every row and a width alongside it', () => {
    const table = insertCols(sample(), 1);
    expect(grid(table)).toEqual([
      ['a1', '', 'b1', 'c1'],
      ['a2', '', 'b2', 'c2'],
    ]);
    expectRectangular(table);
  });

  it('clamps an out-of-range index rather than leaving a hole', () => {
    expect(tableRows(insertRows(sample(), 99))).toHaveLength(3);
    expect(columnCount(insertCols(sample(), 99))).toBe(4);
  });
});

describe('duplicate', () => {
  it('copies a row below itself', () => {
    expect(grid(duplicateRow(sample(), 0))).toEqual([
      ['a1', 'b1', 'c1'],
      ['a1', 'b1', 'c1'],
      ['a2', 'b2', 'c2'],
    ]);
  });

  it('gives the copy no identity, so it is a new block and not the same one twice', () => {
    const withIds = schema.nodes.table.create({ columnWidths: [TABLE_COL_W] }, [
      schema.nodes.line.create(),
      schema.nodes.tableRow.create({ id: 'r1', sid: 'aaa' }, [
        schema.nodes.line.create(),
        schema.nodes.tableCell.create({ id: 'c1', sid: 'bbb' }, schema.nodes.line.create()),
      ]),
    ]);
    const [, copy] = tableRows(duplicateRow(withIds, 0));
    expect(copy.attrs.id).toBe('');
    expect(copy.attrs.sid).toBe('');
    expect(rowCells(copy)[0].attrs.sid).toBe('');
  });

  it('copies a column and its width', () => {
    const table = duplicateCol(setColumnWidth(sample(), 1, 240), 1);
    expect(grid(table)).toEqual([
      ['a1', 'b1', 'b1', 'c1'],
      ['a2', 'b2', 'b2', 'c2'],
    ]);
    expect(columnWidths(table)).toEqual([TABLE_COL_W, 240, 240, TABLE_COL_W]);
  });
});

describe('remove', () => {
  it('takes a row out', () => {
    expect(grid(removeRow(sample(), 0))).toEqual([['a2', 'b2', 'c2']]);
  });

  it('takes a column out along with its width', () => {
    const table = removeCol(sample(), 1);
    expect(grid(table)).toEqual([
      ['a1', 'c1'],
      ['a2', 'c2'],
    ]);
    expectRectangular(table);
  });

  it('refuses the last row and the last column', () => {
    // An empty grid has no grip left to add anything back with, so the block
    // would become a dead rectangle you can only remove.
    const one = tableOf([['only']]);
    expect(removeRow(one, 0)).toBe(one);
    expect(removeCol(one, 0)).toBe(one);
  });
});

describe('trim', () => {
  it('drops from the end and stops at one', () => {
    const table = tableOf([['a'], ['b'], ['c']]);
    expect(grid(trimRows(table, 2))).toEqual([['a']]);
    expect(grid(trimRows(table, 99))).toEqual([['a']]);
  });

  it('drops columns from the end with their widths', () => {
    const table = trimCols(sample(), 2);
    expect(grid(table)).toEqual([['a1'], ['a2']]);
    expectRectangular(table);
  });
});

describe('move', () => {
  it('lands a row in the gap the indicator pointed at', () => {
    const table = tableOf([['a'], ['b'], ['c']]);
    expect(grid(moveRow(table, 0, 2))).toEqual([['b'], ['a'], ['c']]);
    expect(grid(moveRow(table, 2, 0))).toEqual([['c'], ['a'], ['b']]);
  });

  it('moves a column and its width together', () => {
    const table = moveCol(setColumnWidth(sample(), 0, 300), 0, 3);
    expect(grid(table)).toEqual([
      ['b1', 'c1', 'a1'],
      ['b2', 'c2', 'a2'],
    ]);
    expect(columnWidths(table)).toEqual([TABLE_COL_W, TABLE_COL_W, 300]);
  });

  it('knows that dropping either side of yourself changes nothing', () => {
    expect(movesAnything(1, 1)).toBe(false);
    expect(movesAnything(1, 2)).toBe(false);
    expect(movesAnything(1, 3)).toBe(true);
    expect(landedAt(0, 2)).toBe(1);
    expect(landedAt(2, 0)).toBe(0);
  });
});

describe('cells', () => {
  it('clears the text of a rectangle and keeps the fill', () => {
    // The colour is a property of the row you built, not of the words in it.
    const filled = fillRect(sample(), { r0: 0, c0: 0, r1: 1, c1: 1 }, 'amber');
    const cleared = clearRect(filled, { r0: 0, c0: 0, r1: 0, c1: 1 });
    expect(grid(cleared)).toEqual([
      ['', '', 'c1'],
      ['a2', 'b2', 'c2'],
    ]);
    expect(rowCells(tableRows(cleared)[0])[0].attrs.fill).toBe('amber');
  });

  it('fills the rectangle whichever corner it was dragged from', () => {
    const table = fillRect(sample(), { r0: 1, c0: 2, r1: 0, c1: 1 }, 'blue');
    const fills = tableRows(table).map((row) => rowCells(row).map((cell) => cell.attrs.fill));
    expect(fills).toEqual([
      ['', 'blue', 'blue'],
      ['', 'blue', 'blue'],
    ]);
  });

  it('normalizes a rectangle dragged backwards', () => {
    expect(normalizeRect({ r0: 3, c0: 4, r1: 1, c1: 2 })).toEqual({ r0: 1, r1: 3, c0: 2, c1: 4 });
  });
});

describe('widths', () => {
  it('holds a column above the size you can aim at', () => {
    expect(columnWidths(setColumnWidth(sample(), 0, 10))[0]).toBe(TABLE_MIN_COL_W);
  });

  it('drops the fit rule when a width is set by hand', () => {
    const fitted = sample().type.create({ ...sample().attrs, fullWidth: true }, sample().content);
    expect(setColumnWidth(fitted, 0, 300).attrs.fullWidth).toBe(false);
  });

  it('reconciles a stored list that disagrees with the rows', () => {
    // The attr and the row shape are two facts that can disagree after a paste or
    // a half-applied edit, and every reader wants one answer.
    const table = sample().type.create({ ...sample().attrs, columnWidths: [300] }, sample().content);
    expect(columnWidths(table)).toEqual([300, TABLE_COL_W, TABLE_COL_W]);
  });
});

describe('squareUp', () => {
  it('pads a short row and trims a long one', () => {
    const ragged = tableOf([
      ['a', 'b', 'c'],
      ['d'],
    ]);
    const repaired = squareUp(ragged);
    expect(repaired).not.toBeNull();
    expect(grid(repaired!)).toEqual([
      ['a', 'b', 'c'],
      ['d', '', ''],
    ]);
  });

  it('says nothing when there is nothing to repair', () => {
    expect(squareUp(sample())).toBeNull();
  });
});

describe('positions', () => {
  it('round-trips a cell through the caret position', () => {
    const table = sample();
    // Placed in a document so the offsets are the ones a real caret would take.
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, schema.nodes.line.create(null, schema.text('before'))),
      table,
    ]);
    const tablePos = doc.firstChild!.nodeSize;
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 3; col++) {
        const at = cellCaretPos(table, tablePos, row, col);
        expect(at).not.toBeNull();
        expect(cellAtPos(table, tablePos, at!)).toEqual({ row, col });
      }
    }
  });

  it('answers null for a cell that is not there', () => {
    expect(cellCaretPos(sample(), 0, 9, 0)).toBeNull();
    expect(cellCaretPos(sample(), 0, 0, 9)).toBeNull();
  });
});
