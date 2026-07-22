/**
 * `placeToolbar`'s decision logic, exercised with fabricated rects rather than
 * real DOM measurement, `coordsAtPos`/`getBoundingClientRect` return zeros
 * under jsdom, so this is the only way to prove the above/below and
 * horizontal-clamp decisions independent of environment.
 */
import { describe, expect, it } from 'vitest';
import { MIN_ABOVE_SPACE, placeToolbar, type Rect } from './position';

const SIZE = { width: 200, height: 40 };
const VIEWPORT = { width: 1000, height: 800 };

function rectAt(top: number, left: number, width = 20): Rect {
  return { top, bottom: top + 20, left, right: left + width };
}

describe('above/below', () => {
  it('prefers sitting above the selection when there is room', () => {
    const placement = placeToolbar(rectAt(200, 400), SIZE, VIEWPORT);
    expect(placement.showAbove).toBe(true);
    expect(placement.top).toBe(200 - SIZE.height - 8);
  });

  it('drops below once the selection is too close to the top', () => {
    const anchor = rectAt(MIN_ABOVE_SPACE - 1, 400);
    const placement = placeToolbar(anchor, SIZE, VIEWPORT);
    expect(placement.showAbove).toBe(false);
    expect(placement.top).toBe(anchor.bottom + 8); // anchor.bottom + gutter
  });

  it('the exact threshold still counts as room', () => {
    const placement = placeToolbar(rectAt(MIN_ABOVE_SPACE, 400), SIZE, VIEWPORT);
    expect(placement.showAbove).toBe(true);
  });
});

describe('horizontal clamping', () => {
  it('centers on the selection when there is room on both sides', () => {
    const placement = placeToolbar(rectAt(200, 400, 20), SIZE, VIEWPORT);
    // anchor center is 410; toolbar centered there sits at 410 - 100 = 310.
    expect(placement.left).toBe(310);
  });

  it('never lets the toolbar cross the left edge', () => {
    const placement = placeToolbar(rectAt(200, 0, 10), SIZE, VIEWPORT);
    expect(placement.left).toBe(4);
  });

  it('never lets the toolbar cross the right edge', () => {
    const placement = placeToolbar(rectAt(200, 990, 10), SIZE, VIEWPORT);
    expect(placement.left).toBe(VIEWPORT.width - SIZE.width - 4);
  });

  it('clamps rather than throws when the toolbar is wider than the viewport', () => {
    const tiny = { width: 100, height: 800 };
    expect(() => placeToolbar(rectAt(200, 40), SIZE, tiny)).not.toThrow();
    const placement = placeToolbar(rectAt(200, 40), SIZE, tiny);
    expect(placement.left).toBe(4);
  });
});
