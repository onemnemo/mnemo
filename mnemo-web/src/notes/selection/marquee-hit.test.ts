// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';

import { createEditorSchema } from '../editor/schema';
import {
  bandFrom,
  firstRowTouching,
  lastRowTouching,
  marqueeRows,
  rectsIntersect,
} from './marquee-hit';

const { schema, registry } = createEditorSchema();

const line = (text?: string) => schema.nodes.line.create(null, text ? schema.text(text) : null);
const para = (text: string, sid: string) => schema.nodes.paragraph.create({ sid, id: sid }, line(text));
const column = (sid: string, ...blocks: PMNode[]) =>
  schema.nodes.columnGroup.create({ sid, id: sid }, [line(), ...blocks]);

function mixedDoc(): PMNode {
  const twoColumn = schema.nodes.twoColumn.create({ sid: 'tc', id: 'tc' }, [
    line(),
    column('colL', para('a', 'sA'), para('b', 'sB')),
    column('colR', para('c', 'sC')),
  ]);
  return schema.nodes.doc.create(null, [para('one', 's1'), twoColumn, para('three', 's3')]);
}

describe('bandFrom', () => {
  it('normalizes any two corners into a left/top/right/bottom rect', () => {
    expect(bandFrom({ x: 10, y: 40 }, { x: 4, y: 8 })).toEqual({ left: 4, top: 8, right: 10, bottom: 40 });
    expect(bandFrom({ x: 4, y: 8 }, { x: 10, y: 40 })).toEqual({ left: 4, top: 8, right: 10, bottom: 40 });
  });
});

describe('rectsIntersect', () => {
  const band = { left: 0, top: 0, right: 10, bottom: 10 };
  it('touching edges count as intersecting', () => {
    expect(rectsIntersect(band, { left: 10, top: 0, right: 20, bottom: 10 })).toBe(true);
    expect(rectsIntersect(band, { left: 0, top: 10, right: 10, bottom: 20 })).toBe(true);
  });
  it('disjoint rects do not', () => {
    expect(rectsIntersect(band, { left: 11, top: 0, right: 20, bottom: 10 })).toBe(false);
    expect(rectsIntersect(band, { left: 0, top: 11, right: 10, bottom: 20 })).toBe(false);
  });
});

describe('row binary searches', () => {
  // Five 100px rows from y=0.
  const tops = [0, 100, 200, 300, 400];
  const bottoms = [100, 200, 300, 400, 500];
  const topOf = (i: number) => tops[i];
  const bottomOf = (i: number) => bottoms[i];

  it('firstRowTouching finds the first row whose bottom reaches y', () => {
    expect(firstRowTouching(5, bottomOf, -50)).toBe(0);
    expect(firstRowTouching(5, bottomOf, 100)).toBe(0);
    expect(firstRowTouching(5, bottomOf, 101)).toBe(1);
    expect(firstRowTouching(5, bottomOf, 450)).toBe(4);
    expect(firstRowTouching(5, bottomOf, 501)).toBe(5);
  });

  it('lastRowTouching finds the last row whose top is at or above y', () => {
    expect(lastRowTouching(5, topOf, -1)).toBe(-1);
    expect(lastRowTouching(5, topOf, 0)).toBe(0);
    expect(lastRowTouching(5, topOf, 250)).toBe(2);
    expect(lastRowTouching(5, topOf, 9999)).toBe(4);
  });

  it('the [first, last] range is exactly the rows a vertical span covers', () => {
    // A band from 150 to 350 covers rows 1..3.
    expect(firstRowTouching(5, bottomOf, 150)).toBe(1);
    expect(lastRowTouching(5, topOf, 350)).toBe(3);
  });
});

describe('marqueeRows', () => {
  it('one row per document child, with every selectable sid within', () => {
    const doc = mixedDoc();
    const rows = marqueeRows(doc, registry);
    expect(rows).toHaveLength(3);
    expect(rows[0].sids).toEqual(['s1']);
    expect(rows[1].sids).toEqual(['sA', 'sB', 'sC']);
    expect(rows[2].sids).toEqual(['s3']);
  });

  it('a two-column row exposes its cell children for per-cell hits', () => {
    const doc = mixedDoc();
    const rows = marqueeRows(doc, registry);
    expect(rows[0].cellChildren).toBeNull();
    const cells = rows[1].cellChildren;
    expect(cells?.map((cell) => cell.sids)).toEqual([['sA'], ['sB'], ['sC']]);
    // Each cell child's position resolves back to that block.
    for (const cell of cells ?? []) {
      const node = doc.nodeAt(cell.pos);
      expect(String(node?.attrs.sid)).toBe(cell.sids[0]);
    }
  });

  it('is cached by document identity', () => {
    const doc = mixedDoc();
    expect(marqueeRows(doc, registry)).toBe(marqueeRows(doc, registry));
  });

  it('opens up a two-column nested inside a cell instead of treating it as one unit', () => {
    const inner = schema.nodes.twoColumn.create({ sid: 'tcInner', id: 'tcInner' }, [
      line(),
      column('innerL', para('p', 'sP'), para('q', 'sQ')),
      column('innerR', para('r', 'sR')),
    ]);
    const outer = schema.nodes.twoColumn.create({ sid: 'tcOuter', id: 'tcOuter' }, [
      line(),
      column('outerL', inner),
      column('outerR', para('s', 'sS')),
    ]);
    const doc = schema.nodes.doc.create(null, [outer]);
    const rows = marqueeRows(doc, registry);
    // Each leaf of the inner row is its own hit unit; the inner row never
    // appears as one child covering all three.
    expect(rows[0].cellChildren?.map((cell) => cell.sids)).toEqual([['sP'], ['sQ'], ['sR'], ['sS']]);
  });
});
