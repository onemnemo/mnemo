/**
 * The table's edits, as whole-node transforms.
 *
 * A table is the one block where the *edit* is the hard part. Insert, move,
 * duplicate, clear and delete all have to keep rows and columns in step, and
 * every one of them is a place to leave a row one cell short. So each operation
 * here takes a table node and returns a table node, and nothing in this file
 * knows about transactions, selections or the DOM: a ragged table becomes
 * something you can rule out by reading rather than something you find by
 * clicking.
 *
 * Building a whole node per edit is O(table) where a targeted step would be
 * O(1). At the sizes a note actually holds that is nothing, and it buys the one
 * property that matters: the table before an edit is still intact if the edit is
 * abandoned, which is exactly what a drag that changes its mind needs. Cells that
 * did not change are reused by reference, so their ids, their marks and their
 * NodeViews survive.
 *
 * Typing does not come through here. A cell's text is ordinary ProseMirror
 * content and is edited as such; this is only for the shape.
 */

import type { Node as PMNode, Schema } from 'prosemirror-model';

/** Wide enough for two or three words before wrapping. */
export const TABLE_COL_W = 180;
/** Below this a column is a sliver you cannot aim at, so resizing stops here. */
export const TABLE_MIN_COL_W = 72;

/** A rectangle of cells, inclusive at both corners. */
export interface Rect {
  readonly r0: number;
  readonly c0: number;
  readonly r1: number;
  readonly c1: number;
}

export const normalizeRect = (rect: Rect): Rect => ({
  r0: Math.min(rect.r0, rect.r1),
  r1: Math.max(rect.r0, rect.r1),
  c0: Math.min(rect.c0, rect.c1),
  c1: Math.max(rect.c0, rect.c1),
});

export const isSingleCell = (rect: Rect): boolean => rect.r0 === rect.r1 && rect.c0 === rect.c1;

export const rectHolds = (rect: Rect | null, row: number, col: number): boolean =>
  rect !== null && row >= rect.r0 && row <= rect.r1 && col >= rect.c0 && col <= rect.c1;

/* -------------------------------------------------------------------------- */
/* Reading                                                                    */
/* -------------------------------------------------------------------------- */

/** Everything after the mandatory line, which for a table is its rows. */
function afterLine(node: PMNode): PMNode[] {
  const out: PMNode[] = [];
  node.forEach((child, _offset, index) => {
    if (index === 0 && (child.type.name === 'line' || child.type.name === 'codeLine')) return;
    out.push(child);
  });
  return out;
}

export const tableRows = (table: PMNode): PMNode[] => afterLine(table);
export const rowCells = (row: PMNode): PMNode[] => afterLine(row);

/** The widest row, so a ragged table still reports a usable column count. */
export function columnCount(table: PMNode): number {
  let widest = 0;
  for (const row of tableRows(table)) widest = Math.max(widest, rowCells(row).length);
  return widest;
}

/**
 * The stored widths, padded and trimmed to the column count.
 *
 * The attr and the row shape are two facts that can disagree (a paste, an older
 * note, an undo caught mid-way), and every reader wants one answer, so the
 * reconciling happens once, here.
 */
export function columnWidths(table: PMNode): number[] {
  const stored = Array.isArray(table.attrs.columnWidths) ? (table.attrs.columnWidths as unknown[]) : [];
  const count = columnCount(table);
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const value = stored[i];
    out.push(typeof value === 'number' && value >= TABLE_MIN_COL_W ? value : TABLE_COL_W);
  }
  return out;
}

export const rowRect = (table: PMNode, row: number): Rect => ({
  r0: row,
  r1: row,
  c0: 0,
  c1: Math.max(0, columnCount(table) - 1),
});

export const colRect = (table: PMNode, col: number): Rect => ({
  r0: 0,
  r1: Math.max(0, tableRows(table).length - 1),
  c0: col,
  c1: col,
});

/**
 * Where the caret goes to be in cell `(row, col)`, as an absolute position.
 *
 * Walked rather than derived from a formula: a cell's size depends on its own
 * text, so the only way to the next row's start is past everything before it.
 * Returns null when the cell does not exist, which is what a caller asking for a
 * cell in a table that just shrank should get.
 */
export function cellCaretPos(table: PMNode, tablePos: number, row: number, col: number): number | null {
  const rows = tableRows(table);
  const target = rows[row];
  if (!target) return null;

  // Past the table's own boundary and its mandatory line.
  let at = tablePos + 1 + (table.firstChild?.nodeSize ?? 2);
  for (let r = 0; r < row; r++) at += rows[r].nodeSize;

  const cells = rowCells(target);
  if (!cells[col]) return null;
  // Past the row's boundary and its own line.
  let cellAt = at + 1 + (target.firstChild?.nodeSize ?? 2);
  for (let c = 0; c < col; c++) cellAt += cells[c].nodeSize;

  // Past the cell's boundary and into its line's content.
  return cellAt + 2;
}

/**
 * Which cell an absolute document position falls in, or null for none.
 *
 * The inverse of `cellCaretPos`, and the reason both exist: the chrome reasons in
 * row and column, ProseMirror reasons in positions, and every crossing between
 * the two has to walk the same nodes in the same order or they disagree by a
 * cell somewhere past the first wrapped row.
 */
export function cellAtPos(
  table: PMNode,
  tablePos: number,
  pos: number,
): { row: number; col: number } | null {
  const rows = tableRows(table);
  let at = tablePos + 1 + (table.firstChild?.nodeSize ?? 2);
  for (let row = 0; row < rows.length; row++) {
    const rowNode = rows[row];
    if (pos < at || pos > at + rowNode.nodeSize) {
      at += rowNode.nodeSize;
      continue;
    }
    const cells = rowCells(rowNode);
    let cellAt = at + 1 + (rowNode.firstChild?.nodeSize ?? 2);
    for (let col = 0; col < cells.length; col++) {
      const cell = cells[col];
      if (pos >= cellAt && pos <= cellAt + cell.nodeSize) return { row, col };
      cellAt += cell.nodeSize;
    }
    return null;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Building                                                                   */
/* -------------------------------------------------------------------------- */

export function emptyCell(schema: Schema): PMNode {
  return schema.nodes.tableCell.create(null, schema.nodes.line.create());
}

export function buildRow(schema: Schema, cells: PMNode[]): PMNode {
  return schema.nodes.tableRow.create(null, [schema.nodes.line.create(), ...cells]);
}

function rebuild(table: PMNode, rows: PMNode[], attrs?: Record<string, unknown>): PMNode {
  const line = table.firstChild;
  return table.type.create(
    attrs ? { ...table.attrs, ...attrs } : table.attrs,
    [line && line.type.name === 'line' ? line : table.type.schema.nodes.line.create(), ...rows],
  );
}

function withCells(row: PMNode, cells: PMNode[]): PMNode {
  const line = row.firstChild;
  return row.type.create(row.attrs, [
    line && line.type.name === 'line' ? line : row.type.schema.nodes.line.create(),
    ...cells,
  ]);
}

/** A blank table of the given shape, ready to be inserted. */
export function createTable(schema: Schema, rows = 3, cols = 3): PMNode {
  const body = Array.from({ length: rows }, () =>
    buildRow(
      schema,
      Array.from({ length: cols }, () => emptyCell(schema)),
    ),
  );
  return schema.nodes.table.create(
    { columnWidths: Array.from({ length: cols }, () => TABLE_COL_W) },
    [schema.nodes.line.create(), ...body],
  );
}

/* -------------------------------------------------------------------------- */
/* Operations                                                                 */
/* -------------------------------------------------------------------------- */

export function insertRows(table: PMNode, at: number, count = 1): PMNode {
  const schema = table.type.schema;
  const cols = columnCount(table);
  const rows = tableRows(table);
  const made = Array.from({ length: count }, () =>
    buildRow(
      schema,
      Array.from({ length: cols }, () => emptyCell(schema)),
    ),
  );
  rows.splice(Math.max(0, Math.min(at, rows.length)), 0, ...made);
  return rebuild(table, rows);
}

export function insertCols(table: PMNode, at: number, count = 1): PMNode {
  const schema = table.type.schema;
  const widths = columnWidths(table);
  const index = Math.max(0, Math.min(at, widths.length));
  widths.splice(index, 0, ...Array.from({ length: count }, () => TABLE_COL_W));
  const rows = tableRows(table).map((row) => {
    const cells = rowCells(row);
    cells.splice(index, 0, ...Array.from({ length: count }, () => emptyCell(schema)));
    return withCells(row, cells);
  });
  return rebuild(table, rows, { columnWidths: widths });
}

/**
 * A copy of a block with its identity dropped.
 *
 * Duplicating has to mean a *new* block. Reusing the node would give two
 * positions the same id and the same sid, and a sid is the name the AI has
 * already quoted back; blanking them hands the identity plugin a block it can see
 * is new, and the server mints the sid on the next commit as it does for anything
 * else created in the editor.
 */
function withoutIdentity(node: PMNode): PMNode {
  return node.type.create({ ...node.attrs, id: '', sid: '' }, node.content, node.marks);
}

export function duplicateRow(table: PMNode, at: number): PMNode {
  const rows = tableRows(table);
  const source = rows[at];
  if (!source) return table;
  const copy = withCells(
    withoutIdentity(source),
    rowCells(source).map((cell) => withoutIdentity(cell)),
  );
  rows.splice(at + 1, 0, copy);
  return rebuild(table, rows);
}

export function duplicateCol(table: PMNode, at: number): PMNode {
  const widths = columnWidths(table);
  if (at < 0 || at >= widths.length) return table;
  widths.splice(at + 1, 0, widths[at]);
  const rows = tableRows(table).map((row) => {
    const cells = rowCells(row);
    const source = cells[at];
    cells.splice(at + 1, 0, source ? withoutIdentity(source) : emptyCell(table.type.schema));
    return withCells(row, cells);
  });
  return rebuild(table, rows, { columnWidths: widths });
}

/**
 * The last row and the last column are not deletable.
 *
 * An empty grid has no grip left to add anything back with, so the block would
 * become a dead rectangle you can only remove. Removing the block is the block
 * menu's job, and it says so by name.
 */
export function removeRow(table: PMNode, at: number): PMNode {
  const rows = tableRows(table);
  if (rows.length <= 1 || at < 0 || at >= rows.length) return table;
  return rebuild(
    table,
    rows.filter((_row, index) => index !== at),
  );
}

export function removeCol(table: PMNode, at: number): PMNode {
  const widths = columnWidths(table);
  if (widths.length <= 1 || at < 0 || at >= widths.length) return table;
  return rebuild(
    table,
    tableRows(table).map((row) =>
      withCells(
        row,
        rowCells(row).filter((_cell, index) => index !== at),
      ),
    ),
    { columnWidths: widths.filter((_width, index) => index !== at) },
  );
}

/**
 * Drops rows or columns off the end.
 *
 * The undo half of a rail drag: dragging back up has to take away exactly what
 * dragging down put there, so this counts from the end and stops at one.
 */
export function trimRows(table: PMNode, count: number): PMNode {
  const rows = tableRows(table);
  return rebuild(table, rows.slice(0, Math.max(1, rows.length - count)));
}

export function trimCols(table: PMNode, count: number): PMNode {
  const widths = columnWidths(table);
  const keep = Math.max(1, widths.length - count);
  return rebuild(
    table,
    tableRows(table).map((row) => withCells(row, rowCells(row).slice(0, keep))),
    { columnWidths: widths.slice(0, keep) },
  );
}

/** `to` is the gap the run lands in, counted before the move, which is what a
 *  drop indicator between two columns is pointing at. */
function shift<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(from < to ? to - 1 : to, 0, item);
  return next;
}

export function moveRow(table: PMNode, from: number, to: number): PMNode {
  return rebuild(table, shift(tableRows(table), from, to));
}

export function moveCol(table: PMNode, from: number, to: number): PMNode {
  return rebuild(
    table,
    tableRows(table).map((row) => withCells(row, shift(rowCells(row), from, to))),
    { columnWidths: shift(columnWidths(table), from, to) },
  );
}

/** Where a move lands a run, counted after the splice. */
export const landedAt = (from: number, to: number): number => (to > from ? to - 1 : to);

/** Whether a move would change anything: dropping either side of yourself is a no-op. */
export const movesAnything = (from: number, to: number): boolean => to !== from && to !== from + 1;

export function fillRect(table: PMNode, rect: Rect, fill: string): PMNode {
  const box = normalizeRect(rect);
  return rebuild(
    table,
    tableRows(table).map((row, r) => {
      if (r < box.r0 || r > box.r1) return row;
      return withCells(
        row,
        rowCells(row).map((cell, c) =>
          c < box.c0 || c > box.c1 ? cell : cell.type.create({ ...cell.attrs, fill }, cell.content),
        ),
      );
    }),
  );
}

/**
 * Empties the text of every cell in the rectangle, keeping the fill.
 *
 * The colour is a property of the row you built, not of the words that happened
 * to be in it. Wiping both is the kind of helpful that costs a minute of
 * re-colouring.
 */
export function clearRect(table: PMNode, rect: Rect): PMNode {
  const schema = table.type.schema;
  const box = normalizeRect(rect);
  return rebuild(
    table,
    tableRows(table).map((row, r) => {
      if (r < box.r0 || r > box.r1) return row;
      return withCells(
        row,
        rowCells(row).map((cell, c) =>
          c < box.c0 || c > box.c1 ? cell : cell.type.create(cell.attrs, schema.nodes.line.create()),
        ),
      );
    }),
  );
}

export function setColumnWidth(table: PMNode, at: number, width: number): PMNode {
  const widths = columnWidths(table);
  if (at < 0 || at >= widths.length) return table;
  widths[at] = Math.max(TABLE_MIN_COL_W, Math.round(width));
  // Explicit widths beat a fit rule, and the toggle is still there to put the
  // table back under one.
  return rebuild(table, tableRows(table), { columnWidths: widths, fullWidth: false });
}

/**
 * Pads short rows and trims long ones so every row has the same cells.
 *
 * Not something the operations above can produce; it is what a paste, a partly
 * applied agent edit or an older note can hand us, and every overlay in the view
 * indexes cells by column.
 */
export function squareUp(table: PMNode): PMNode | null {
  const schema = table.type.schema;
  const cols = columnCount(table);
  if (cols === 0) return null;
  let changed = false;
  const rows = tableRows(table).map((row) => {
    const cells = rowCells(row);
    if (cells.length === cols) return row;
    changed = true;
    const next = cells.slice(0, cols);
    while (next.length < cols) next.push(emptyCell(schema));
    return withCells(row, next);
  });
  const widths = columnWidths(table);
  const stored = table.attrs.columnWidths;
  const widthsDiffer = !Array.isArray(stored) || stored.length !== widths.length;
  if (!changed && !widthsDiffer) return null;
  return rebuild(table, rows, { columnWidths: widths });
}
