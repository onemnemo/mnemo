// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { selectionBands, type Rect } from './selection-bands';

/** A block of `height` starting at `top`, spanning the measure. */
function block(top: number, height: number): Rect {
  return { top, bottom: top + height, left: 100, right: 500 };
}

const joined = () => true;
const separate = () => false;

describe('selectionBands', () => {
  it('pads a lone block on both ends and bleeds past the measure', () => {
    const [band] = selectionBands([block(100, 30)], joined);
    expect(band.top).toBe(98);
    expect(band.height).toBe(34);
    expect(band.left).toBe(94);
    expect(band.width).toBe(412);
  });

  it('splits the space between two neighbours, leaving a hairline', () => {
    // 30px of leading between them: the two bands meet at the midpoint, 2px apart.
    const [first, second] = selectionBands([block(100, 20), block(150, 20)], joined);
    expect(first.top + first.height).toBe(134);
    expect(second.top).toBe(136);
    // The outer ends still get their padding.
    expect(first.top).toBe(98);
    expect(second.top + second.height).toBe(172);
  });

  it('leaves the same hairline whatever the leading is', () => {
    const tight = selectionBands([block(0, 20), block(26, 20)], joined);
    const loose = selectionBands([block(0, 20), block(120, 20)], joined);
    const gapOf = (bands: ReturnType<typeof selectionBands>) =>
      bands[1].top - (bands[0].top + bands[0].height);
    expect(gapOf(tight)).toBe(2);
    expect(gapOf(loose)).toBe(2);
  });

  it('keeps both padded edges where the selection skips a block', () => {
    // Two runs, not one: the unselected block between them must show through.
    const [first, second] = selectionBands([block(0, 20), block(200, 20)], separate);
    expect(first.top + first.height).toBe(22);
    expect(second.top).toBe(198);
  });

  it('pads both of two blocks that sit side by side', () => {
    // A two-column row: there is no vertical space between the cells to divide.
    const left: Rect = { top: 100, bottom: 140, left: 100, right: 290 };
    const right: Rect = { top: 100, bottom: 160, left: 310, right: 500 };
    const [a, b] = selectionBands([left, right], joined);
    expect(a.top).toBe(98);
    expect(a.height).toBe(44);
    expect(b.top).toBe(98);
    expect(b.height).toBe(64);
  });

  it('never returns a negative height', () => {
    // Overlapping rects (a nested row's own box against its child) must not
    // invert into a band drawn upwards.
    const bands = selectionBands([block(0, 100), block(10, 10)], joined);
    for (const band of bands) expect(band.height).toBeGreaterThanOrEqual(0);
  });
});
