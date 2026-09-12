// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { DROP_LINE_HEIGHT } from './resolve-block-reorder';
import {
  resolveColumnDrop,
  sameBlockDropTarget,
  stickyIndex,
  type BlockDropTarget,
  type ColumnRow,
  type DragSource,
  type Lane,
  type ResolveColumnDropInput,
} from './resolve-column-drop';

/** The left lane holds two 50px blocks; the right lane one 200px block filling the row. */
const LEFT: Lane = {
  cellPos: 10,
  cellSid: 'left',
  blockCount: 2,
  left: 0,
  width: 292,
  rows: [
    { index: 0, top: 100, bottom: 150 },
    { index: 1, top: 150, bottom: 200 },
  ],
};

const RIGHT: Lane = {
  cellPos: 40,
  cellSid: 'right',
  blockCount: 1,
  left: 308,
  width: 292,
  rows: [{ index: 0, top: 100, bottom: 300 }],
};

/** One layout on the page, y 100 to 300, x 0 to 600, with a 16px splitter between the lanes. */
const ROW: ColumnRow = { pos: 8, depth: 0, top: 100, bottom: 300, left: 0, width: 600, lanes: [LEFT, RIGHT] };

/** A block on the page, well away from the layout. */
const PAGE_SOURCE: DragSource = { pos: 400, end: 410, cellPos: null, cellIndex: null };

function input(overrides: Partial<ResolveColumnDropInput> = {}): ResolveColumnDropInput {
  return { rows: [ROW], pointer: { x: 100, y: 120 }, source: PAGE_SOURCE, previous: null, ...overrides };
}

describe('resolveColumnDrop lane choice', () => {
  it('is null when the pointer is above, below or beside every layout', () => {
    expect(resolveColumnDrop(input({ pointer: { x: 100, y: 99 } }))).toBeNull();
    expect(resolveColumnDrop(input({ pointer: { x: 100, y: 300 } }))).toBeNull();
    expect(resolveColumnDrop(input({ pointer: { x: 700, y: 150 } }))).toBeNull();
  });

  it('lands in the lane under the pointer, with the line at the lane width', () => {
    const drop = resolveColumnDrop(input({ pointer: { x: 400, y: 120 } }));
    expect(drop).toMatchObject({ kind: 'cell', cellPos: 40, cellSid: 'right', insertIndex: 0, moveTo: 0 });
    expect(drop).toMatchObject({ line: { top: 100 - DROP_LINE_HEIGHT / 2, left: 308, width: 292 } });
  });

  it('picks the slot by the same quarter bands as the page, from the row edge in', () => {
    expect(resolveColumnDrop(input({ pointer: { x: 100, y: 100 } }))).toMatchObject({ insertIndex: 0 });
    expect(resolveColumnDrop(input({ pointer: { x: 100, y: 145 } }))).toMatchObject({ insertIndex: 1 });
    expect(resolveColumnDrop(input({ pointer: { x: 100, y: 190 } }))).toMatchObject({ insertIndex: 2 });
  });

  it('appends in the empty space under a shorter lane', () => {
    const drop = resolveColumnDrop(input({ pointer: { x: 100, y: 260 } }));
    expect(drop).toMatchObject({ kind: 'cell', cellPos: 10, insertIndex: 2, moveTo: 2 });
    expect(drop).toMatchObject({ line: { top: 200 - DROP_LINE_HEIGHT / 2 } });
  });

  it('snaps a pointer on the splitter to the nearer lane', () => {
    expect(resolveColumnDrop(input({ pointer: { x: 298, y: 120 } }))).toMatchObject({ cellPos: 10 });
    expect(resolveColumnDrop(input({ pointer: { x: 302, y: 120 } }))).toMatchObject({ cellPos: 40 });
  });
});

describe('resolveColumnDrop own slot', () => {
  const inLeft: DragSource = { pos: 12, end: 20, cellPos: 10, cellIndex: 0 };

  it("stays, rather than falling to the page, over the dragged block's own slot", () => {
    expect(resolveColumnDrop(input({ source: inLeft, pointer: { x: 100, y: 110 } }))).toEqual({ kind: 'stay' });
    expect(resolveColumnDrop(input({ source: inLeft, pointer: { x: 100, y: 149 } }))).toEqual({ kind: 'stay' });
  });

  it('shifts a move down its own lane by the slot it leaves', () => {
    const drop = resolveColumnDrop(input({ source: inLeft, pointer: { x: 100, y: 195 } }));
    expect(drop).toMatchObject({ kind: 'cell', insertIndex: 2, moveTo: 1 });
  });

  it('does not shift a move into the other lane', () => {
    const drop = resolveColumnDrop(input({ source: inLeft, pointer: { x: 400, y: 280 } }));
    expect(drop).toMatchObject({ kind: 'cell', cellPos: 40, insertIndex: 1, moveTo: 1 });
  });

  it('stays in a lane whose only block is the one being dragged', () => {
    const inRight: DragSource = { pos: 42, end: 50, cellPos: 40, cellIndex: 0 };
    expect(resolveColumnDrop(input({ source: inRight, pointer: { x: 400, y: 200 } }))).toEqual({ kind: 'stay' });
  });
});

describe('resolveColumnDrop sticky middle', () => {
  it('keeps the edge already shown in the same lane', () => {
    const drop = resolveColumnDrop(input({ pointer: { x: 100, y: 120 }, previous: { cellPos: 10, insertIndex: 1 } }));
    expect(drop).toMatchObject({ insertIndex: 1 });
  });

  it('ignores an edge shown in another lane or on the page', () => {
    expect(
      resolveColumnDrop(input({ pointer: { x: 100, y: 120 }, previous: { cellPos: 40, insertIndex: 1 } })),
    ).toMatchObject({ insertIndex: 0 });
    expect(
      resolveColumnDrop(input({ pointer: { x: 100, y: 120 }, previous: { cellPos: null, insertIndex: 1 } })),
    ).toMatchObject({ insertIndex: 0 });
  });
});

describe('resolveColumnDrop nesting', () => {
  /** A layout inside the right lane, y 150 to 250, its own lanes splitting the right lane's width. */
  const NESTED: ColumnRow = {
    pos: 44,
    depth: 1,
    top: 150,
    bottom: 250,
    left: 308,
    width: 292,
    lanes: [
      { cellPos: 46, cellSid: 'nested-left', blockCount: 1, left: 308, width: 138, rows: [{ index: 0, top: 150, bottom: 250 }] },
      { cellPos: 60, cellSid: 'nested-right', blockCount: 1, left: 462, width: 138, rows: [{ index: 0, top: 150, bottom: 250 }] },
    ],
  };
  const outer: ColumnRow = {
    ...ROW,
    lanes: [
      LEFT,
      {
        ...RIGHT,
        blockCount: 3,
        rows: [
          { index: 0, top: 100, bottom: 150 },
          { index: 1, top: 150, bottom: 250 },
          { index: 2, top: 250, bottom: 300 },
        ],
      },
    ],
  };

  it('lets the innermost layout under the pointer decide, whatever order the rows come in', () => {
    expect(resolveColumnDrop(input({ rows: [outer, NESTED], pointer: { x: 500, y: 200 } }))).toMatchObject({
      cellPos: 60,
    });
    expect(resolveColumnDrop(input({ rows: [NESTED, outer], pointer: { x: 500, y: 200 } }))).toMatchObject({
      cellPos: 60,
    });
  });

  it('treats the nested layout as one row of the enclosing lane outside its rectangle', () => {
    const drop = resolveColumnDrop(input({ rows: [outer, NESTED], pointer: { x: 500, y: 140 } }));
    expect(drop).toMatchObject({ kind: 'cell', cellPos: 40, insertIndex: 1 });
  });

  it('never lands inside the block being dragged', () => {
    const draggingTheLayout: DragSource = { pos: 8, end: 100, cellPos: null, cellIndex: null };
    expect(resolveColumnDrop(input({ source: draggingTheLayout }))).toBeNull();
  });
});

describe('stickyIndex', () => {
  it('answers only for the lane, or the page, the last slot was in', () => {
    expect(stickyIndex(null, 10)).toBeNull();
    expect(stickyIndex({ cellPos: 10, insertIndex: 2 }, 10)).toBe(2);
    expect(stickyIndex({ cellPos: 10, insertIndex: 2 }, null)).toBeNull();
    expect(stickyIndex({ cellPos: null, insertIndex: 2 }, null)).toBe(2);
  });
});

describe('sameBlockDropTarget', () => {
  const line = { top: 99, left: 0, width: 600, height: DROP_LINE_HEIGHT };
  const gap: BlockDropTarget = { kind: 'gap', insertIndex: 1, moveTo: 1, line };
  const cell: BlockDropTarget = { kind: 'cell', cellPos: 10, cellSid: 'left', insertIndex: 1, moveTo: 1, line };

  it('treats the same gap, or the same lane slot, as one target', () => {
    expect(sameBlockDropTarget(gap, { ...gap })).toBe(true);
    expect(sameBlockDropTarget(cell, { ...cell })).toBe(true);
    expect(sameBlockDropTarget(null, null)).toBe(true);
  });

  it('tells apart a gap from a cell, two lanes, two slots and a scrolled line', () => {
    expect(sameBlockDropTarget(gap, cell)).toBe(false);
    expect(sameBlockDropTarget(cell, { ...cell, cellPos: 40 })).toBe(false);
    expect(sameBlockDropTarget(cell, { ...cell, insertIndex: 0, moveTo: 0 })).toBe(false);
    expect(sameBlockDropTarget(gap, { ...gap, line: { ...line, top: 149 } })).toBe(false);
    expect(sameBlockDropTarget(gap, null)).toBe(false);
  });
});
