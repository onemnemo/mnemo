/**
 * `placeToolbar`'s decision logic, exercised with fabricated rects rather than
 * real DOM measurement, `coordsAtPos`/`getBoundingClientRect` return zeros
 * under jsdom, so this is the only way to prove the above/below and
 * horizontal-clamp decisions independent of environment.
 */
import { describe, expect, it } from 'vitest';
import {
  MENU_HEIGHT_ESTIMATE,
  MENU_MAX_HEIGHT,
  MIN_ABOVE_SPACE,
  placeMenu,
  placePopover,
  placeToolbar,
  type Rect,
} from './position';

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
    // 4 below, not the 8 used above: the desktop's two anchor offsets.
    expect(placement.top).toBe(anchor.bottom + 4);
  });

  it('the exact threshold still counts as room', () => {
    const placement = placeToolbar(rectAt(MIN_ABOVE_SPACE, 400), SIZE, VIEWPORT);
    expect(placement.showAbove).toBe(true);
  });
});

describe('vertical clamping', () => {
  it('keeps a below-placed toolbar inside a short viewport', () => {
    // Below the flip threshold, so it is placed below, and the line sits low
    // enough in a short viewport that the preferred top overflows the bottom.
    const short = { width: 1000, height: 90 };
    const placement = placeToolbar(rectAt(MIN_ABOVE_SPACE - 8, 400), SIZE, short);
    expect(placement.showAbove).toBe(false);
    expect(placement.top).toBe(short.height - SIZE.height - 4);
  });

  it('never places the toolbar above the top edge', () => {
    // Taller than the room the above/below flip assumed, so the preferred top
    // is negative and only the clamp keeps it reachable.
    const tall = { width: 200, height: 200 };
    const placement = placeToolbar(rectAt(60, 400), tall, VIEWPORT);
    expect(placement.showAbove).toBe(true);
    expect(placement.top).toBe(4);
  });

  it('clamps to the top rather than off-screen when the toolbar is taller than the viewport', () => {
    const placement = placeToolbar(rectAt(200, 400), { width: 200, height: 900 }, VIEWPORT);
    expect(placement.top).toBe(4);
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

/**
 * The menu differs from the toolbar on both axes on purpose: it is a list read
 * downward from the caret, so it is left-aligned and sits below unless below
 * genuinely cannot hold it.
 */
describe('placeMenu', () => {
  const MENU = { width: 300, height: 340 };

  it('sits below the line, left-aligned to it', () => {
    const anchor = rectAt(200, 400);
    const placement = placeMenu(anchor, MENU, VIEWPORT);
    expect(placement.showAbove).toBe(false);
    expect(placement.top).toBe(anchor.bottom + 4);
    expect(placement.left).toBe(400);
  });

  it('goes above only when below is short AND above has more room', () => {
    // Below is short in both, and only the second has more room above.
    const shallow = { width: 1000, height: 300 };
    expect(placeMenu(rectAt(20, 400), MENU, shallow).showAbove).toBe(false);
    expect(placeMenu(rectAt(240, 400), MENU, shallow).showAbove).toBe(true);
  });

  it('caps its height to the room on the side it took, rather than covering the line', () => {
    const shallow = { width: 1000, height: 300 };
    const placement = placeMenu(rectAt(20, 400), MENU, shallow);
    // Anchor bottom is 40, so 300 - 40 - 4 gutter - 4 margin.
    expect(placement.maxHeight).toBe(252);
    expect(placement.top).toBe(44);
    // The cap is what keeps it clear of the line it is anchored to.
    expect(placement.top + placement.maxHeight).toBeLessThanOrEqual(shallow.height - 4);
  });

  it('caps against the room above when it goes above', () => {
    const shallow = { width: 1000, height: 300 };
    const placement = placeMenu(rectAt(240, 400), MENU, shallow);
    expect(placement.showAbove).toBe(true);
    expect(placement.maxHeight).toBe(232);
    expect(placement.top).toBe(4);
  });

  it('never grows past the palette height, however much room the side has', () => {
    // A tall window with the caret near the top: below has 750px of room, and
    // the menu must still be a palette rather than a column down the page.
    const tall = { width: 1000, height: 800 };
    const full = { width: 300, height: 700 };
    const placement = placeMenu(rectAt(40, 400), full, tall);
    expect(placement.maxHeight).toBe(MENU_MAX_HEIGHT);
    // And the top follows the capped height, not the height it asked for.
    expect(placement.top).toBe(64);
  });

  it('never reports a negative cap for a line pressed against the edge', () => {
    const placement = placeMenu(rectAt(VIEWPORT.height - 2, 400), MENU, VIEWPORT);
    expect(placement.maxHeight).toBeGreaterThanOrEqual(0);
  });

  it('takes the full estimate below when there is room, and does not go above', () => {
    const roomy = { width: 1000, height: MENU_HEIGHT_ESTIMATE * 3 };
    expect(placeMenu(rectAt(100, 400), MENU, roomy).showAbove).toBe(false);
  });

  it('clamps to the right edge like the toolbar does', () => {
    const placement = placeMenu(rectAt(200, 900), MENU, VIEWPORT);
    expect(placement.left).toBe(VIEWPORT.width - MENU.width - 4);
  });
});

/**
 * The colour palette, placed against the toolbar rather than against the text.
 * `left` is an offset from the toolbar's own left edge, so 0 means "as drawn".
 */
describe('the palette hanging off the toolbar', () => {
  const PALETTE = { width: 240, height: 130 };

  /** A toolbar rect: 40 tall, the two rows the buttons can wrap to. */
  function toolbarAt(top: number, left: number, width = 300): Rect {
    return { top, bottom: top + 40, left, right: left + width };
  }

  it('opens below the toolbar when there is room under it', () => {
    expect(placePopover(toolbarAt(200, 400), PALETTE, VIEWPORT).showAbove).toBe(false);
  });

  it('flips above when the toolbar is against the bottom edge', () => {
    const placement = placePopover(toolbarAt(VIEWPORT.height - 60, 400), PALETTE, VIEWPORT);
    expect(placement.showAbove).toBe(true);
  });

  it('stays below when neither side can hold it and below has more room', () => {
    // A window too short for the palette on either side of a centred toolbar.
    const shallow = { width: 1000, height: 200 };
    const placement = placePopover(toolbarAt(60, 400), PALETTE, shallow);
    expect(placement.showAbove).toBe(false);
  });

  it('leaves the popover where the CSS drew it when nothing is in the way', () => {
    expect(placePopover(toolbarAt(200, 400), PALETTE, VIEWPORT).left).toBe(0);
  });

  it('pulls the popover left when it would run off the right edge', () => {
    // The toolbar is clamped to the edge, and the palette is wider than the
    // room left of it, so the offset has to be negative.
    const placement = placePopover(toolbarAt(200, 860), PALETTE, VIEWPORT);
    expect(placement.left).toBe(VIEWPORT.width - PALETTE.width - 4 - 860);
    expect(placement.left).toBeLessThan(0);
  });

  it('pushes the popover right when the toolbar sits past the left margin', () => {
    expect(placePopover(toolbarAt(200, 0), PALETTE, VIEWPORT).left).toBe(4);
  });
});
