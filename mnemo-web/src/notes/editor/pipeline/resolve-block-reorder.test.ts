// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  DROP_LINE_HEIGHT,
  resolveBlockReorder,
  type BlockRow,
  type ResolveReorderInput,
} from './resolve-block-reorder';

/** Five 100px blocks stacked from y=0, so bands are the round numbers 25/75. */
const ROWS: BlockRow[] = [
  { index: 0, top: 0, bottom: 100 },
  { index: 1, top: 100, bottom: 200 },
  { index: 2, top: 200, bottom: 300 },
  { index: 3, top: 300, bottom: 400 },
  { index: 4, top: 400, bottom: 500 },
];

function input(overrides: Partial<ResolveReorderInput>): ResolveReorderInput {
  return {
    rows: ROWS,
    blockCount: 5,
    // A block far from the boundaries under test, so no-op suppression never fires.
    sourceIndex: 4,
    pointerY: 0,
    left: 40,
    width: 600,
    previousInsertIndex: null,
    ...overrides,
  };
}

describe('resolveBlockReorder nested source (extraction)', () => {
  it('suppresses no gap: every top-level boundary is a real landing', () => {
    // Around the top of the document, where a top-level source at 0 would be
    // suppressed, an extraction still resolves.
    const target = resolveBlockReorder(input({ sourceIndex: null, pointerY: 10 }));
    expect(target?.insertIndex).toBe(0);
    expect(target?.moveTo).toBe(0);
  });

  it('lands unshifted: nothing leaves the top level, so moveTo equals the gap', () => {
    const target = resolveBlockReorder(input({ sourceIndex: null, pointerY: 490 }));
    expect(target?.insertIndex).toBe(5);
    expect(target?.moveTo).toBe(5);
  });

  it('resolves against a single-block document, where a top-level move cannot', () => {
    const rows = [ROWS[0]];
    expect(resolveBlockReorder(input({ rows, blockCount: 1, sourceIndex: 0, pointerY: 90 }))).toBeNull();
    const target = resolveBlockReorder(input({ rows, blockCount: 1, sourceIndex: null, pointerY: 90 }));
    expect(target?.insertIndex).toBe(1);
    expect(target?.moveTo).toBe(1);
  });
});

describe('resolveBlockReorder bands', () => {
  it('top quarter of a row inserts before it', () => {
    // 110 is inside block 1's top band [100, 125).
    expect(resolveBlockReorder(input({ pointerY: 110 }))?.insertIndex).toBe(1);
  });

  it('bottom quarter of a row inserts after it', () => {
    // 290 is inside block 2's bottom band [275, 300).
    expect(resolveBlockReorder(input({ pointerY: 290 }))?.insertIndex).toBe(3);
  });

  it('a first entry into the middle band splits on the midpoint', () => {
    // Just above block 1's midpoint (150) chooses the top edge.
    expect(resolveBlockReorder(input({ pointerY: 149 }))?.insertIndex).toBe(1);
    // At or past the midpoint chooses the bottom edge.
    expect(resolveBlockReorder(input({ pointerY: 150 }))?.insertIndex).toBe(2);
  });

  it('the middle band is sticky: it keeps whichever edge is already shown', () => {
    // 140 is past block 1's midpoint, which would pick 2 on first entry, but a
    // prior 1 holds it at 1 so the line does not flip mid-block.
    expect(resolveBlockReorder(input({ pointerY: 140, previousInsertIndex: 1 }))?.insertIndex).toBe(1);
    // 130 is before the midpoint, but a prior 2 holds it at 2.
    expect(resolveBlockReorder(input({ pointerY: 130, previousInsertIndex: 2 }))?.insertIndex).toBe(2);
  });

  it('a prior edge belonging to another row does not stick', () => {
    // previousInsertIndex 99 is neither of block 1's edges, so the midpoint decides.
    expect(resolveBlockReorder(input({ pointerY: 149, previousInsertIndex: 99 }))?.insertIndex).toBe(1);
  });

  it('floors the snap band at 4px for short rows', () => {
    const rows: BlockRow[] = [
      { index: 0, top: 0, bottom: 10 },
      { index: 1, top: 10, bottom: 20 },
    ];
    // 10px row: a quarter is 2.5px, floored to 4px. y=3 sits in block 0's top band
    // [0, 4) and inserts before it.
    expect(resolveBlockReorder(input({ rows, blockCount: 2, sourceIndex: 1, pointerY: 3 }))?.insertIndex).toBe(0);
    // y=18 sits in block 1's bottom band [16, 20) and inserts after it.
    expect(resolveBlockReorder(input({ rows, blockCount: 2, sourceIndex: 0, pointerY: 18 }))?.insertIndex).toBe(2);
  });
});

describe('resolveBlockReorder edges', () => {
  it('above the first row inserts before it', () => {
    expect(resolveBlockReorder(input({ pointerY: -20 }))?.insertIndex).toBe(0);
  });

  it('below the last realized row appends at the document end', () => {
    expect(resolveBlockReorder(input({ sourceIndex: 0, pointerY: 600 }))?.insertIndex).toBe(5);
  });

  it('a pointer in the margin gap between two blocks lands on their shared boundary, not the document end', () => {
    // Border-box rects exclude the 8px block margin, so adjacent blocks leave a gap.
    const rows: BlockRow[] = [
      { index: 0, top: 0, bottom: 100 },
      { index: 1, top: 108, bottom: 208 },
    ];
    // y=104 sits in the [100, 108) gap; it must insert between the two blocks (gap
    // is under block 0, so "after block 0" = index 1), never jump to the end.
    const target = resolveBlockReorder(input({ rows, blockCount: 3, sourceIndex: 2, pointerY: 104 }));
    expect(target?.insertIndex).toBe(1);
  });

  it('past the last realized row inserts at the true end, not after the last visible block', () => {
    // Only two of five blocks are realized; a drop below them lands at the true end.
    const rows: BlockRow[] = [
      { index: 0, top: 0, bottom: 100 },
      { index: 1, top: 100, bottom: 200 },
    ];
    const target = resolveBlockReorder(input({ rows, blockCount: 5, sourceIndex: 0, pointerY: 400 }));
    expect(target?.insertIndex).toBe(5);
    expect(target?.moveTo).toBe(4);
    // The line clamps to the last visible block's bottom.
    expect(target?.line.top).toBe(200 - DROP_LINE_HEIGHT / 2);
  });
});

describe('resolveBlockReorder no-op suppression', () => {
  it('is null when the block would land on its own slot', () => {
    // Top band of block 0 with source 0 -> insertIndex 0 -> no move.
    expect(resolveBlockReorder(input({ sourceIndex: 0, pointerY: 10 }))).toBeNull();
  });

  it('is null when the block would land in the gap right after itself', () => {
    // Bottom band of block 0 with source 0 -> insertIndex 1 -> no move.
    expect(resolveBlockReorder(input({ sourceIndex: 0, pointerY: 90 }))).toBeNull();
  });

  it('is null for a single-block document', () => {
    expect(resolveBlockReorder(input({ rows: [ROWS[0]], blockCount: 1, sourceIndex: 0, pointerY: 50 }))).toBeNull();
  });
});

describe('resolveBlockReorder move index and line', () => {
  it('shifts the move target down by one when moving forward past its own slot', () => {
    // Source 0 to block 2's top band -> insertIndex 2, but removing block 0 first
    // makes the landing index 1.
    const target = resolveBlockReorder(input({ sourceIndex: 0, pointerY: 210 }));
    expect(target?.insertIndex).toBe(2);
    expect(target?.moveTo).toBe(1);
  });

  it('does not shift the move target when moving backward', () => {
    // Source 4 to block 0's top band -> insertIndex 0, landing index 0.
    const target = resolveBlockReorder(input({ sourceIndex: 4, pointerY: 10 }));
    expect(target?.insertIndex).toBe(0);
    expect(target?.moveTo).toBe(0);
  });

  it('draws the line at the boundary block top, centred on the gap', () => {
    const target = resolveBlockReorder(input({ sourceIndex: 0, pointerY: 210 }));
    expect(target?.line).toEqual({
      top: 200 - DROP_LINE_HEIGHT / 2,
      left: 40,
      width: 600,
      height: DROP_LINE_HEIGHT,
    });
  });

  it('draws the append line at the last realized row bottom', () => {
    // Source 0 to block 4's bottom band -> append at the end.
    const target = resolveBlockReorder(input({ sourceIndex: 0, pointerY: 490 }));
    expect(target?.insertIndex).toBe(5);
    expect(target?.line.top).toBe(500 - DROP_LINE_HEIGHT / 2);
  });
});
