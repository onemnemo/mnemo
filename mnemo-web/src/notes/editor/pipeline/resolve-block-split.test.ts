// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { editorSchema } from '../schema';
import { sameBlockDropTarget } from './resolve-column-drop';
import {
  SPLIT_BAND_MAX,
  SPLIT_BAND_MIN,
  canBeSplitSource,
  insideTable,
  resolveBlockSplit,
  splitBandWidth,
  splitRowOf,
  holdsTwoColumn,
  SPLIT_MIN_TRAVEL,
  type SplitRow,
  type SplitSource,
} from './resolve-block-split';

const row = (over: Partial<SplitRow> = {}): SplitRow => ({
  pos: 10,
  end: 20,
  sid: 'target',
  type: 'paragraph',
  top: 100,
  bottom: 140,
  left: 200,
  width: 700,
  holdsLayout: false,
  ...over,
});

const source: SplitSource = { pos: 40, end: 50, type: 'paragraph', inTable: false, holdsLayout: false };

describe('splitBandWidth', () => {
  it('is a tenth of the width inside the clamp', () => {
    expect(splitBandWidth(700)).toBe(70);
  });

  it('clamps to the minimum and the maximum', () => {
    expect(splitBandWidth(300)).toBe(SPLIT_BAND_MIN);
    expect(splitBandWidth(2000)).toBe(SPLIT_BAND_MAX);
  });

  it('never lets the two bands overlap', () => {
    expect(splitBandWidth(80)).toBe(40);
    expect(splitBandWidth(0)).toBe(0);
  });
});

describe('splitRowOf', () => {
  it('reads the range, sid and type off the node', () => {
    const { schema } = editorSchema();
    const node = schema.nodes.paragraph.create({ sid: 'abc' }, schema.nodes.line.create());
    const rect = { top: 1, bottom: 2, left: 3, width: 4 };
    expect(splitRowOf(node, 7, rect)).toEqual({ pos: 7, end: 7 + node.nodeSize, sid: 'abc', type: 'paragraph', holdsLayout: false, ...rect });
  });
});

describe('insideTable', () => {
  it('is true for a block in a table cell and false elsewhere', () => {
    const { schema } = editorSchema();
    const n = schema.nodes;
    const inner = n.paragraph.create(null, n.line.create());
    const cell = n.tableCell.create(null, [n.line.create(), inner]);
    const table = n.table.create(null, [n.line.create(), n.tableRow.create(null, [n.line.create(), cell])]);
    const doc = n.doc.create(null, [n.paragraph.create(null, n.line.create()), table]);
    let innerPos = -1;
    doc.descendants((node, pos) => {
      if (node === inner) innerPos = pos;
    });
    expect(insideTable(doc, innerPos)).toBe(true);
    expect(insideTable(doc, 0)).toBe(false);
  });
});

describe('holdsTwoColumn', () => {
  const { schema } = editorSchema();
  const n = schema.nodes;
  const para = () => n.paragraph.create(null, n.line.create());
  const layout = () => n.twoColumn.create(null, [n.line.create(), n.columnGroup.create(null, [n.line.create(), para()]), n.columnGroup.create(null, [n.line.create(), para()])]);

  it('finds a layout that is the block or sits below it', () => {
    expect(holdsTwoColumn(layout())).toBe(true);
    expect(holdsTwoColumn(n.bulletItem.create(null, [n.line.create(), layout()]))).toBe(true);
    expect(holdsTwoColumn(n.callout.create(null, [n.line.create(), n.bulletItem.create(null, [n.line.create(), layout()])]))).toBe(true);
  });

  it('is false for a block with no layout', () => {
    expect(holdsTwoColumn(para())).toBe(false);
    expect(holdsTwoColumn(n.bulletItem.create(null, [n.line.create(), para()]))).toBe(false);
  });
});

describe('resolveBlockSplit', () => {
  const at = (x: number, y = 120, rows: SplitRow[] = [row()], src: SplitSource = source, pressX = 100) =>
    resolveBlockSplit({ rows, pointer: { x, y }, pressX, source: src });

  it('picks the left band and draws a vertical line on the target left edge', () => {
    const target = at(230)!;
    expect(target.kind).toBe('split');
    expect(target.side).toBe('left');
    expect(target.pos).toBe(10);
    expect(target.sid).toBe('target');
    expect(target.line).toEqual({ top: 100, left: 199, width: 2, height: 40 });
  });

  it('picks the right band and draws the line on the right edge', () => {
    const target = at(880)!;
    expect(target.side).toBe('right');
    expect(target.line.left).toBe(899);
  });

  it('keeps the band edges exact', () => {
    expect(at(200)?.side).toBe('left');
    expect(at(269)?.side).toBe('left');
    expect(at(270)).toBeNull();
    expect(at(829)).toBeNull();
    expect(at(830)?.side).toBe('right');
    expect(at(899)?.side).toBe('right');
    expect(at(900)).toBeNull();
  });

  it('is null in the middle, outside the block and outside its rows', () => {
    expect(at(500)).toBeNull();
    expect(at(150)).toBeNull();
    expect(at(230, 99)).toBeNull();
    expect(at(230, 140)).toBeNull();
  });

  it('picks the row under the pointer', () => {
    const rows = [row({ pos: 1, sid: 'a', top: 0, bottom: 50 }), row({ pos: 2, sid: 'b', top: 50, bottom: 90 })];
    expect(at(230, 70, rows)?.sid).toBe('b');
  });

  it('refuses a layout, a table and a divider as the target', () => {
    for (const type of ['twoColumn', 'table', 'divider']) {
      expect(at(230, 120, [row({ type })]), type).toBeNull();
    }
  });

  it('refuses a layout or a divider as the source', () => {
    expect(canBeSplitSource('twoColumn')).toBe(false);
    expect(canBeSplitSource('divider')).toBe(false);
    expect(canBeSplitSource('table')).toBe(true);
    expect(at(230, 120, [row()], { ...source, type: 'twoColumn' })).toBeNull();
    expect(at(230, 120, [row()], { ...source, type: 'divider' })).toBeNull();
  });

  it('refuses a source or target that already holds a layout', () => {
    expect(at(230, 120, [row({ holdsLayout: true })])).toBeNull();
    expect(at(230, 120, [row()], { ...source, holdsLayout: true })).toBeNull();
  });

  // Row left is 200 and the left band runs to 270. A nested block's grip sits inside that band.
  describe.each([
    ['top-level block', 176],
    ['list child', 224],
    ['second-level list child', 248],
    ['callout child', 230],
  ])('with the grip of a %s pressed at x=%i', (_name, pressX) => {
    it('does not split on a straight vertical drag', () => {
      expect(at(pressX, 120, [row()], source, pressX)).toBeNull();
      expect(at(pressX + SPLIT_MIN_TRAVEL - 1, 120, [row()], source, pressX)).toBeNull();
    });

    it('splits once the pointer has moved sideways into the band', () => {
      const x = pressX <= 230 ? 262 : 215;
      expect(Math.abs(x - pressX)).toBeGreaterThanOrEqual(SPLIT_MIN_TRAVEL);
      expect(at(x, 120, [row()], source, pressX)?.side).toBe('left');
    });
  });

  it('refuses a source inside a table', () => {
    expect(at(230, 120, [row()], { ...source, inTable: true })).toBeNull();
  });

  it('refuses the dragged block own edge and a block that holds the dragged one', () => {
    expect(at(230, 120, [row()], { pos: 10, end: 20, type: 'paragraph', inTable: false, holdsLayout: false })).toBeNull();
    expect(at(230, 120, [row()], { pos: 14, end: 18, type: 'paragraph', inTable: false, holdsLayout: false })).toBeNull();
  });

  it('allows a neighbour of the dragged block', () => {
    expect(at(230, 120, [row()], { pos: 20, end: 30, type: 'paragraph', inTable: false, holdsLayout: false })?.side).toBe('left');
    expect(at(230, 120, [row()], { pos: 0, end: 10, type: 'paragraph', inTable: false, holdsLayout: false })?.side).toBe('left');
  });

  it('uses the whole width on a narrow block, split in half', () => {
    const narrow = row({ width: 80 });
    expect(at(239, 120, [narrow])?.side).toBe('left');
    expect(at(240, 120, [narrow])?.side).toBe('right');
  });
});

describe('sameBlockDropTarget with a split', () => {
  const split = (side: 'left' | 'right', top = 100) => ({
    kind: 'split' as const,
    pos: 10,
    sid: 'target',
    side,
    line: { top, left: 0, width: 2, height: 40 },
  });
  const gap = {
    kind: 'gap' as const,
    insertIndex: 1,
    moveTo: 1,
    line: { top: 100, left: 0, width: 10, height: 2 },
  };

  it('compares position, side and line top', () => {
    expect(sameBlockDropTarget(split('left'), split('left'))).toBe(true);
    expect(sameBlockDropTarget(split('left'), split('right'))).toBe(false);
    expect(sameBlockDropTarget(split('left'), split('left', 120))).toBe(false);
  });

  it('never equals another kind of target', () => {
    expect(sameBlockDropTarget(split('left'), gap)).toBe(false);
    expect(sameBlockDropTarget(gap, split('left'))).toBe(false);
    expect(sameBlockDropTarget(split('left'), null)).toBe(false);
  });
});
