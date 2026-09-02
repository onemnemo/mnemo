// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';

import { createEditorSchema } from '../editor/schema';
import { EMPTY_SELECTION, selectSingle } from './block-selection';
import { coveredBlockRanges } from './delete-selected';
import { applyGrip, gripIntent } from './grip-selection';

const { schema, registry } = createEditorSchema();

const line = (text?: string) => schema.nodes.line.create(null, text ? schema.text(text) : null);
const para = (text: string, sid: string) => schema.nodes.paragraph.create({ sid, id: sid }, line(text));
const column = (...blocks: PMNode[]) => schema.nodes.columnGroup.create({ sid: 'col', id: 'col' }, [line(), ...blocks]);

function mixedDoc(): PMNode {
  const twoColumn = schema.nodes.twoColumn.create({ sid: 'tc', id: 'tc' }, [
    line(),
    column(para('a', 'sA')),
    column(para('b', 'sB')),
  ]);
  return schema.nodes.doc.create(null, [para('one', 's1'), twoColumn, para('three', 's3')]);
}

/** A table above a paragraph: two leaves in one top-level block, as a row has. */
function tableDoc(): PMNode {
  const cell = (text: string, sid: string) => schema.nodes.tableCell.create({ sid, id: sid }, line(text));
  const row = schema.nodes.tableRow.create(null, [line(), cell('a', 'c1'), cell('b', 'c2')]);
  const table = schema.nodes.table.create({ columnWidths: [] }, [line(), row]);
  return schema.nodes.doc.create(null, [table, para('below', 's2')]);
}

describe('gripIntent', () => {
  it('maps modifiers to intents; a plain click selects, like the desktop grip', () => {
    const base = { ctrlKey: false, metaKey: false, shiftKey: false };
    expect(gripIntent(base)).toBe('select');
    expect(gripIntent({ ...base, ctrlKey: true })).toBe('toggle');
    expect(gripIntent({ ...base, metaKey: true })).toBe('toggle');
    expect(gripIntent({ ...base, shiftKey: true })).toBe('range');
    expect(gripIntent({ ...base, ctrlKey: true, shiftKey: true })).toBe('range-add');
  });
});

describe('applyGrip', () => {
  it('select replaces the set with the clicked block', () => {
    const doc = mixedDoc();
    const p1 = doc.child(0);
    const next = applyGrip(doc, registry, selectSingle('s3'), 0, p1, 'select');
    expect(next.selected).toEqual(new Set(['s1']));
    expect(next.anchorSid).toBe('s1');
  });

  it('select keeps a multi-selection the clicked block already belongs to', () => {
    const doc = mixedDoc();
    const p1 = doc.child(0);
    const current = { selected: new Set(['s1', 's3']), anchorSid: 's3' };
    // Clicking into your own selection must not collapse it: the menu the click
    // opens acts on the whole set.
    expect(applyGrip(doc, registry, current, 0, p1, 'select')).toBe(current);
  });

  it('select on a two-column row takes both cell leaves', () => {
    const doc = mixedDoc();
    const tc = doc.child(1);
    const tcPos = doc.child(0).nodeSize;
    const next = applyGrip(doc, registry, EMPTY_SELECTION, tcPos, tc, 'select');
    expect(next.selected).toEqual(new Set(['sA', 'sB']));
  });

  it('toggle adds a block, then a second toggle removes it', () => {
    const doc = mixedDoc();
    const p1 = doc.child(0);
    const added = applyGrip(doc, registry, EMPTY_SELECTION, 0, p1, 'toggle');
    expect(added.selected).toEqual(new Set(['s1']));
    const removed = applyGrip(doc, registry, added, 0, p1, 'toggle');
    expect(removed.selected.size).toBe(0);
  });

  it('toggle on a two-column row acts on both cell leaves at once', () => {
    const doc = mixedDoc();
    const tc = doc.child(1);
    const tcPos = doc.child(0).nodeSize;
    const added = applyGrip(doc, registry, EMPTY_SELECTION, tcPos, tc, 'toggle');
    expect(added.selected).toEqual(new Set(['sA', 'sB']));
    const removed = applyGrip(doc, registry, added, tcPos, tc, 'toggle');
    expect(removed.selected.size).toBe(0);
  });

  it('range extends from the anchor to the clicked block, through a column', () => {
    const doc = mixedDoc();
    const p3 = doc.child(2);
    const p3Pos = doc.child(0).nodeSize + doc.child(1).nodeSize;
    // Anchor on the first paragraph, shift-click the last: the run covers the
    // column's leaves in between.
    const ranged = applyGrip(doc, registry, selectSingle('s1'), p3Pos, p3, 'range');
    expect(ranged.selected).toEqual(new Set(['s1', 'sA', 'sB', 's3']));
  });

  it('range with no anchor selects the clicked block itself', () => {
    const doc = mixedDoc();
    const p3 = doc.child(2);
    const p3Pos = doc.child(0).nodeSize + doc.child(1).nodeSize;
    const ranged = applyGrip(doc, registry, EMPTY_SELECTION, p3Pos, p3, 'range');
    expect(ranged.selected).toEqual(new Set(['s3']));
  });

  it('range-add unions the run onto the current selection', () => {
    const doc = mixedDoc();
    const p1 = doc.child(0);
    // Start with the last paragraph selected but the anchor still on it, then
    // range-add from that anchor back to the first paragraph.
    const start = selectSingle('s3');
    const added = applyGrip(doc, registry, start, 0, p1, 'range-add');
    expect(added.selected).toEqual(new Set(['s1', 'sA', 'sB', 's3']));
  });
});

/**
 * A block above the anchor is still the whole block. Covering only the leaf the
 * run happens to end on leaves one column or one table cell selected, and the
 * Backspace that follows takes half a row away.
 */
describe('applyGrip extending onto a multi leaf block above the anchor', () => {
  it('takes both cells of a two-column row, as extending downward does', () => {
    const doc = mixedDoc();
    const tc = doc.child(1);
    const tcPos = doc.child(0).nodeSize;
    const next = applyGrip(doc, registry, selectSingle('s3'), tcPos, tc, 'range');
    expect(next.selected).toEqual(new Set(['sA', 'sB', 's3']));
  });

  it('keeps the anchor, so a second shift-click re-extends from it', () => {
    const doc = mixedDoc();
    const tcPos = doc.child(0).nodeSize;
    const first = applyGrip(doc, registry, selectSingle('s3'), tcPos, doc.child(1), 'range');
    expect(first.anchorSid).toBe('s3');
    const second = applyGrip(doc, registry, first, 0, doc.child(0), 'range');
    expect(second.selected).toEqual(new Set(['s1', 'sA', 'sB', 's3']));
  });

  it('range-add takes the whole block too', () => {
    const doc = mixedDoc();
    const tcPos = doc.child(0).nodeSize;
    const next = applyGrip(doc, registry, selectSingle('s3'), tcPos, doc.child(1), 'range-add');
    expect(next.selected).toEqual(new Set(['sA', 'sB', 's3']));
  });

  it('takes the whole table, so the delete plan removes what was highlighted', () => {
    const doc = tableDoc();
    const next = applyGrip(doc, registry, selectSingle('s2'), 0, doc.child(0), 'range');
    expect(next.selected).toEqual(new Set(['c1', 'c2', 's2']));
    const ranges = coveredBlockRanges(doc, registry, next.selected);
    expect(ranges.map((range) => doc.nodeAt(range.from)?.type.name)).toEqual(['table', 'paragraph']);
  });
});
