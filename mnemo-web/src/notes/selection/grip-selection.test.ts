// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';

import { createEditorSchema } from '../editor/schema';
import { EMPTY_SELECTION, selectSingle } from './block-selection';
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
