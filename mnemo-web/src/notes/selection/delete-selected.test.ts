// @vitest-environment node

/**
 * `coveredBlockRanges` is the one place that turns a Mode A block selection
 * into the ranges an edit removes, shared by the delete verb and, through
 * `replaceSelectedBlocks`, by paste. Nothing exercised it directly before this
 * file: the table cases here lock in a real corruption this shared boundary
 * had, found by tracing how a selection reaches a table's cells at all.
 *
 * A cell is a real selectable leaf (`selectableEntries` excludes only the
 * structural containers, and a `tableCell` is deliberately not one of them),
 * so an ordinary Shift-range between two blocks with a table in between can
 * land its anchor or target on a cell's own sid without the table itself, or
 * even the cell's whole row, ever being covered. `planDeletions` used to treat
 * a fully covered cell exactly like a fully covered paragraph: a bare range,
 * deleted on its own. That tears the cell out of its row, the one thing a
 * table's own commands never do (`removeRow`/`removeCol` refuse to take a
 * table below one row or column, and the block menu is the only way to remove
 * the whole thing).
 */

import { describe, expect, it } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';

import { createEditorSchema } from '../editor/schema';
import { coveredBlockRanges, buildDeleteSelected } from './delete-selected';

const { schema, registry } = createEditorSchema();

const line = (text?: string) => schema.nodes.line.create(null, text ? schema.text(text) : null);
const para = (text: string, sid: string) => schema.nodes.paragraph.create({ sid, id: sid }, line(text));
const tableCell = (text: string, sid: string) => schema.nodes.tableCell.create({ sid, id: sid }, line(text));
const tableRow = (...cells: PMNode[]) => schema.nodes.tableRow.create(null, [line(), ...cells]);
const table = (...rows: PMNode[]) => schema.nodes.table.create({ columnWidths: [] }, [line(), ...rows]);
const docOf = (...blocks: PMNode[]) => schema.nodes.doc.create(null, blocks);

describe('coveredBlockRanges', () => {
  it('deletes two ordinary leaves whole, the base case', () => {
    const doc = docOf(para('one', 's1'), para('two', 's2'), para('three', 's3'));
    const ranges = coveredBlockRanges(doc, registry, new Set(['s1', 's3']));
    expect(ranges.map((r) => doc.nodeAt(r.from)?.textContent)).toEqual(['one', 'three']);
  });

  it('never returns a bare row or cell range for a partial sweep through a table', () => {
    // A shift-range that started above the table and landed on the table's own
    // first cell, the shape a click on the table's grip (anchor = its first
    // cell) followed by a shift-click above it produces.
    const doc = docOf(
      para('before', 'p1'),
      table(tableRow(tableCell('a', 'c1'), tableCell('b', 'c2'))),
      para('after', 'p2'),
    );
    const ranges = coveredBlockRanges(doc, registry, new Set(['p1', 'c1']));

    // The paragraph above the table is covered and goes; nothing about the
    // table does, cell included, even though its sid was in the set.
    expect(ranges).toHaveLength(1);
    expect(doc.nodeAt(ranges[0].from)?.type.name).toBe('paragraph');
    expect(doc.nodeAt(ranges[0].from)?.textContent).toBe('before');
  });

  it('deletes a fully covered table whole, every cell in the selection', () => {
    const doc = docOf(
      para('before', 'p1'),
      table(tableRow(tableCell('a', 'c1'), tableCell('b', 'c2'))),
    );
    const ranges = coveredBlockRanges(doc, registry, new Set(['c1', 'c2']));
    expect(ranges).toHaveLength(1);
    expect(doc.nodeAt(ranges[0].from)?.type.name).toBe('table');
  });

  it('leaves a table alone even when every cell of one row, but not the other, is covered', () => {
    const doc = docOf(
      table(
        tableRow(tableCell('a', 'c1'), tableCell('b', 'c2')),
        tableRow(tableCell('c', 'c3'), tableCell('d', 'c4')),
      ),
    );
    const ranges = coveredBlockRanges(doc, registry, new Set(['c1', 'c2']));
    // A whole row is still short of the whole table; nothing is removable
    // through this path, only through the table's own row command.
    expect(ranges).toHaveLength(0);
  });
});

describe('buildDeleteSelected against a table', () => {
  it('applies to a real transaction without touching the table the selection only grazed', async () => {
    const { EditorState } = await import('prosemirror-state');
    const doc = docOf(
      para('before', 'p1'),
      table(tableRow(tableCell('a', 'c1'), tableCell('b', 'c2'))),
      para('after', 'p2'),
    );
    const state = EditorState.create({ schema, doc });
    const tr = buildDeleteSelected(state, registry, new Set(['p1', 'c1']));
    expect(tr).not.toBeNull();
    const next = state.apply(tr!);

    expect(next.doc.childCount).toBe(2); // "before" is gone, the table and "after" remain
    const remainingTable = next.doc.child(0);
    expect(remainingTable.type.name).toBe('table');
    // Both cells of the one row are intact, "a" included, not just present but
    // shaped like a row instead of a hole where a cell was pulled out.
    const row = remainingTable.child(1);
    expect(row.childCount).toBe(3); // the row's own line plus its two cells
    expect(row.textContent).toBe('ab');
  });
});
