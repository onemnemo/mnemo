/**
 * The header plugin decorates exactly the cells a header row or column covers.
 *
 * Membership is the whole contract: a cell is a header cell if its row is a
 * header, or its column is, or both, and nothing else is touched. Read off the
 * decorated positions rather than any painted style, since the paint is the
 * stylesheet's job and this proves which cells it will reach.
 */

import { describe, expect, it } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';

import { createEditorSchema } from '../schema';
import { cellAtPos, TABLE_COL_W, toggleColumnHeader, toggleRowHeader } from './model';
import { tableHeaderDecorations } from './header-decorations';

const { schema } = createEditorSchema();

/** A 2x3 table wrapped in a doc, so decoration positions are real document positions. */
function docWithTable(mut: (table: PMNode) => PMNode = (t) => t): { doc: PMNode; tablePos: number } {
  const cell = (text: string) =>
    schema.nodes.tableCell.create(null, schema.nodes.line.create(null, schema.text(text)));
  const row = (texts: string[]) =>
    schema.nodes.tableRow.create(null, [schema.nodes.line.create(), ...texts.map(cell)]);
  const bare = schema.nodes.table.create({ columnWidths: [TABLE_COL_W, TABLE_COL_W, TABLE_COL_W] }, [
    schema.nodes.line.create(),
    row(['a1', 'b1', 'c1']),
    row(['a2', 'b2', 'c2']),
  ]);
  const table = mut(bare);
  const doc = schema.nodes.doc.create(null, [
    schema.nodes.paragraph.create(null, schema.nodes.line.create(null, schema.text('before'))),
    table,
  ]);
  return { doc, tablePos: doc.firstChild!.nodeSize };
}

/** The {row, col} of every cell the plugin decorated, sorted for a stable compare. */
function headerCells(doc: PMNode, tablePos: number): { row: number; col: number }[] {
  const table = doc.nodeAt(tablePos)!;
  return tableHeaderDecorations(doc)
    .map((deco) => cellAtPos(table, tablePos, deco.from + 1))
    .filter((cell): cell is { row: number; col: number } => cell !== null)
    .sort((a, b) => a.row - b.row || a.col - b.col);
}

describe('table header decorations', () => {
  it('marks nothing when no row or column is a header', () => {
    const { doc } = docWithTable();
    expect(tableHeaderDecorations(doc)).toHaveLength(0);
  });

  it('marks every cell of a header row', () => {
    const { doc, tablePos } = docWithTable((t) => toggleRowHeader(t, 0));
    expect(headerCells(doc, tablePos)).toEqual([
      { row: 0, col: 0 },
      { row: 0, col: 1 },
      { row: 0, col: 2 },
    ]);
  });

  it('marks every cell of a header column', () => {
    const { doc, tablePos } = docWithTable((t) => toggleColumnHeader(t, 1));
    expect(headerCells(doc, tablePos)).toEqual([
      { row: 0, col: 1 },
      { row: 1, col: 1 },
    ]);
  });

  it('marks the union, and the crossing cell only once', () => {
    const { doc, tablePos } = docWithTable((t) => toggleColumnHeader(toggleRowHeader(t, 0), 0));
    expect(headerCells(doc, tablePos)).toEqual([
      { row: 0, col: 0 },
      { row: 0, col: 1 },
      { row: 0, col: 2 },
      { row: 1, col: 0 },
    ]);
    // The corner cell (0,0) is in both, but it is decorated once, not twice.
    expect(tableHeaderDecorations(doc)).toHaveLength(4);
  });
});
