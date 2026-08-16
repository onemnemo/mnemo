// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';

import { createEditorSchema } from '../editor/schema';
import {
  EMPTY_SELECTION,
  orderedSids,
  selectAll,
  selectableEntries,
  selectRange,
  selectSingle,
  sidsWithin,
  toggleSid,
} from './block-selection';

const { schema, registry } = createEditorSchema();

const line = (text?: string) => schema.nodes.line.create(null, text ? schema.text(text) : null);
const para = (text: string, sid: string) => schema.nodes.paragraph.create({ sid, id: sid }, line(text));
const column = (...blocks: PMNode[]) => schema.nodes.columnGroup.create({ sid: 'col', id: 'col' }, [line(), ...blocks]);

/** [p1] [twoColumn: [pA] | [pB]] [p3] - a leaf, a container with two leaves, a leaf. */
function mixedDoc(): PMNode {
  const twoColumn = schema.nodes.twoColumn.create({ sid: 'tc', id: 'tc' }, [
    line(),
    column(para('a', 'sA')),
    column(para('b', 'sB')),
  ]);
  return schema.nodes.doc.create(null, [para('one', 's1'), twoColumn, para('three', 's3')]);
}

describe('selectableEntries', () => {
  it('is every block except the structural containers, in document order', () => {
    const entries = selectableEntries(mixedDoc(), registry);
    expect(entries.map((entry) => entry.sid)).toEqual(['s1', 'sA', 'sB', 's3']);
    // Neither the two-column row nor the cell wrappers are selectable.
    expect(entries.some((entry) => entry.node.type.name === 'twoColumn')).toBe(false);
    expect(entries.some((entry) => entry.node.type.name === 'columnGroup')).toBe(false);
  });

  it('skips a block with no sid yet', () => {
    const doc = schema.nodes.doc.create(null, [para('one', 's1'), para('unminted', '')]);
    expect(orderedSids(doc, registry)).toEqual(['s1']);
  });
});

describe('set algebra', () => {
  it('selectSingle replaces and anchors on the block', () => {
    expect(selectSingle('sA')).toEqual({ selected: new Set(['sA']), anchorSid: 'sA' });
  });

  it('toggleSid adds then removes, re-anchoring each time', () => {
    const added = toggleSid({ selected: new Set(['s1']), anchorSid: 's1' }, 'sA');
    expect(added).toEqual({ selected: new Set(['s1', 'sA']), anchorSid: 'sA' });
    const removed = toggleSid(added, 's1');
    expect(removed).toEqual({ selected: new Set(['sA']), anchorSid: 's1' });
  });

  it('selectRange takes the inclusive run and keeps the anchor', () => {
    const order = orderedSids(mixedDoc(), registry);
    const range = selectRange(order, { selected: new Set(['s1']), anchorSid: 's1' }, 'sB', false);
    expect(range.selected).toEqual(new Set(['s1', 'sA', 'sB']));
    expect(range.anchorSid).toBe('s1');
  });

  it('selectRange additive unions onto the current set', () => {
    const order = orderedSids(mixedDoc(), registry);
    const range = selectRange(order, { selected: new Set(['s3']), anchorSid: 's1' }, 'sA', true);
    expect(range.selected).toEqual(new Set(['s3', 's1', 'sA']));
  });

  it('selectRange with no usable anchor falls back to the single target', () => {
    const order = orderedSids(mixedDoc(), registry);
    expect(selectRange(order, EMPTY_SELECTION, 'sB', false)).toEqual(selectSingle('sB'));
  });

  it('selectAll takes every sid and anchors on the first', () => {
    const order = orderedSids(mixedDoc(), registry);
    const all = selectAll(order);
    expect(all.selected).toEqual(new Set(['s1', 'sA', 'sB', 's3']));
    expect(all.anchorSid).toBe('s1');
  });
});

describe('sidsWithin', () => {
  it('is the block itself for a leaf', () => {
    const doc = mixedDoc();
    const p1 = doc.child(0);
    expect(sidsWithin(doc, registry, 0, p1)).toEqual(['s1']);
  });

  it('is both cell leaves for a two-column row', () => {
    const doc = mixedDoc();
    const tc = doc.child(1);
    const tcPos = doc.child(0).nodeSize; // right after the first paragraph
    expect(sidsWithin(doc, registry, tcPos, tc)).toEqual(['sA', 'sB']);
  });
});
