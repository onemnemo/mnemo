/**
 * The table as a block type: what the schema refuses, what the wire keeps, what
 * markdown gets, and what the repair pass puts back.
 *
 * The wire half matters most. A table is three block types deep, so a field
 * dropped on the way out is not one cell's worth of loss, it is the shape of
 * everything under it.
 */

import { describe, expect, it } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';

import { buildNoteEditState } from '../../edit/build-edit-state';
import { createEditorSchema } from '../schema';
import { createDocumentMapper } from '../mapper/document';
import { createMarkdownSerializer } from '../mapper/serialize-markdown';
import type { Block } from '../../model/types';
import { plainSpan } from '../../model/spans';
import { TextSelection } from 'prosemirror-state';

import { cellCaretPos, tableRows, rowCells } from '../table/model';
import { insertTable } from './slash-insert';

const { schema, registry, inline } = createEditorSchema();
const mapper = createDocumentMapper(schema, registry);
const markdown = createMarkdownSerializer(registry, inline);

function block(type: Block['type'], text: string, extra: Partial<Block> = {}): Block {
  return {
    id: `${type}-${text}`,
    sid: '',
    type,
    spans: [plainSpan(text)],
    payload: { kind: 'empty' },
    meta: {},
    order: 0,
    children: null,
    ...extra,
  };
}

function wireTable(text: string[][], fills: Record<string, string> = {}): Block {
  return block('Table', '', {
    payload: {
      kind: 'table',
      columnWidths: text[0].map((_unused, index) => 120 + index * 20),
      headerRow: true,
      headerCol: false,
      fullWidth: false,
    },
    children: text.map((row, r) =>
      block('TableRow', '', {
        id: `row-${r}`,
        children: row.map((value, c) =>
          block('TableCell', value, {
            id: `cell-${r}-${c}`,
            payload: { kind: 'tableCell', fill: fills[`${r}:${c}`] ?? '' },
          }),
        ),
      }),
    ),
  });
}

const sample = (): Block[] => [
  block('Heading2', 'Doses'),
  wireTable(
    [
      ['Drug', 'Class'],
      ['Levodopa', 'Precursor'],
    ],
    { '1:1': 'amber' },
  ),
];

describe('the table wire round trip', () => {
  it('keeps the structure, the widths, the header flags and the fills', () => {
    const result = mapper.toDoc(sample());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const back = mapper.fromDoc(result.doc);
    expect(back[1]).toEqual(sample()[1]);
  });

  it('is stable across a second cycle', () => {
    const once = mapper.toDoc(sample());
    if (!once.ok) return;
    const first = mapper.fromDoc(once.doc);
    const twice = mapper.toDoc(first);
    expect(twice.ok).toBe(true);
    if (!twice.ok) return;
    expect(mapper.fromDoc(twice.doc)).toEqual(first);
  });

  it('reports the widths the view was drawn from, not a stale attr', () => {
    // The stored list and the row shape are two facts that can disagree, and what
    // gets written back has to be the one the columns actually had.
    const wire = wireTable([['a', 'b', 'c']]);
    if (wire.payload.kind === 'table') wire.payload.columnWidths = [200];
    const result = mapper.toDoc([wire]);
    if (!result.ok) return;
    const back = mapper.fromDoc(result.doc)[0];
    expect(back.payload.kind === 'table' && back.payload.columnWidths).toEqual([200, 180, 180]);
  });
});

describe('the schema', () => {
  it('refuses a table with no rows and a row with no cells', () => {
    expect(() => schema.nodes.table.createChecked(null, schema.nodes.line.create())).toThrow();
    expect(() => schema.nodes.tableRow.createChecked(null, schema.nodes.line.create())).toThrow();
  });
});

describe('loading damaged data', () => {
  it('seeds a row rather than quarantining the whole note', () => {
    // Nothing on either side of the wire indexes a table positionally, so an
    // empty one is not a crash; making the document unreadable over it would be.
    const empty = block('Table', '', {
      payload: { kind: 'table', columnWidths: [], headerRow: false, headerCol: false, fullWidth: false },
      children: [],
    });
    const result = mapper.toDoc([empty]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const table = result.doc.firstChild!;
    expect(tableRows(table)).toHaveLength(1);
    expect(rowCells(tableRows(table)[0])).toHaveLength(1);
  });

  it('squares a ragged table up on the first edit', () => {
    const ragged = wireTable([['a', 'b', 'c'], ['d']]);
    const state = buildNoteEditState([ragged]);
    expect(state.ok).toBe(true);
    if (!state.ok) return;

    // The repair runs on change, so provoke one: an empty transaction still
    // reports no changed ranges, so touch the first cell's text.
    const before = state.state.doc.firstChild!;
    const at = 1 + (before.firstChild?.nodeSize ?? 2) + 1 + 2 + 2;
    const next = state.state.apply(state.state.tr.insertText('!', at));
    const table = next.doc.firstChild!;
    expect(tableRows(table).map((row) => rowCells(row).length)).toEqual([3, 3]);
  });
});

describe('markdown', () => {
  it('writes a pipe table with the delimiter under the first row', () => {
    const result = mapper.toDoc(sample());
    if (!result.ok) return;
    const out = markdown.document(result.doc);
    expect(out).toContain('| Drug | Class |');
    expect(out).toContain('| --- | --- |');
    expect(out).toContain('| Levodopa | Precursor |');
  });

  it('escapes a pipe so a cell cannot end its own column', () => {
    const result = mapper.toDoc([wireTable([['a|b', 'c']])]);
    if (!result.ok) return;
    expect(markdown.document(result.doc)).toContain('| a\\|b | c |');
  });
});

describe('the slash row', () => {
  it('replaces the block in place and lands the caret in the first cell', () => {
    const state = buildNoteEditState([block('Text', '/table')]);
    expect(state.ok).toBe(true);
    if (!state.ok) return;

    const before = state.state.doc.firstChild!;
    let next = state.state;
    insertTable(state.state, (tr) => {
      next = next.apply(tr);
    });

    const table = next.doc.firstChild!;
    expect(table.type.name).toBe('table');
    // The block keeps its identity: a sid is the name the AI has already quoted
    // back, and a delete-and-reinsert would mint a new one for what the user
    // experiences as one block changing shape.
    expect(table.attrs.id).toBe(before.attrs.id);
    expect(tableRows(table)).toHaveLength(3);
    expect(rowCells(tableRows(table)[0])).toHaveLength(3);
    // Two boundaries and two lines in from the block start, which is the first
    // cell's own line.
    expect(next.selection.from).toBe(cellCaretPos(table, 0, 0, 0));
  });

  it('refuses to nest a table inside a table', () => {
    const state = buildNoteEditState([wireTable([['a', 'b']])]);
    if (!state.ok) return;
    const inCell = cellCaretPos(state.state.doc.firstChild!, 0, 0, 0)!;
    const placed = state.state.apply(
      state.state.tr.setSelection(TextSelection.create(state.state.doc, inCell)),
    );
    let dispatched = false;
    insertTable(placed, () => {
      dispatched = true;
    });
    expect(dispatched).toBe(false);
  });
});

describe('the block node', () => {
  it('renders rows and cells the geometry can find', () => {
    const result = mapper.toDoc(sample());
    if (!result.ok) return;
    const table: PMNode = result.doc.child(1);
    expect(table.type.name).toBe('table');
    expect(tableRows(table)).toHaveLength(2);
    expect(rowCells(tableRows(table)[0]).map((cell) => cell.textContent)).toEqual(['Drug', 'Class']);
  });
});
