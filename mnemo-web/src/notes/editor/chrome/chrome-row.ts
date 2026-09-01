/**
 * Where the block gutter's floating chrome row sits, as arithmetic rather than
 * layout. The row is drawn in a fixed layer, so nothing about its placement
 * falls out of the box model and every number here has to be worked out by
 * hand. Keeping it apart from the component is also the only way it can be
 * tested: jsdom lays nothing out, so a mounted check reports every rect as
 * zero and can say nothing at all about pixels.
 */

/**
 * How far left of the document the hover band and the chrome reach: the page's
 * own margin, which the document column pads out for exactly this. One number
 * for both, so the band always covers wherever the row can be drawn.
 */
const LANE_WIDTH = 56;

/** The row's own metrics: one button's box, the gap between two, and the gap it keeps off the text. */
const CHROME_BUTTON_SIZE = 20;
const CHROME_BUTTON_GAP = 2;
const CHROME_TEXT_GAP = 4;

/**
 * The add-below button and the grip. Every block draws the same row, and its
 * height is the button's plus the air that centres it against a line of text.
 */
const CHROME_WIDTH = 2 * CHROME_BUTTON_SIZE + CHROME_BUTTON_GAP;
const CHROME_HEIGHT = 28;

/**
 * The stacked variant: the same two buttons, one above the other, with a single
 * pixel of backing around them. Every pixel of width past the button itself is
 * width taken out of the neighbouring cell's text, so the padding is the least
 * that still reads as a surface the buttons sit on rather than one they touch.
 */
const CHROME_STACK_PAD = 1;
const CHROME_STACK_WIDTH = CHROME_BUTTON_SIZE + 2 * CHROME_STACK_PAD;
const CHROME_STACK_HEIGHT = 2 * CHROME_BUTTON_SIZE + CHROME_BUTTON_GAP + 2 * CHROME_STACK_PAD;

/**
 * The leftmost x the chrome may be drawn at: the page's own margin and no
 * further. Shared with the hover band, which has to cover everywhere the row
 * can land or the chrome dies under the pointer that is reaching for it.
 */
export function chromeMinLeft(rootLeft: number): number {
  return rootLeft - LANE_WIDTH;
}

export interface ChromeRow {
  left: number;
  width: number;
  height: number;
  /** The row reaches into the document column, so it needs an opaque backing to stay readable. */
  overContent: boolean;
  /** The lane was too narrow for two buttons side by side, so they are stacked. */
  stacked: boolean;
}

/**
 * Where the chrome row sits beside a block, in viewport coordinates.
 *
 * The row is right-aligned against the block, so beside a top-level block it
 * lands in the page's own margin and clears the text entirely.
 *
 * `rootLeft` is the document's own left edge. A block indented past it, the one
 * in the right-hand cell of a two-column row, puts the row over the left cell's
 * text, which reads as printing on the prose unless the row is opaque.
 *
 * `laneLeft` is where the free space beside the block begins: the page margin
 * for a top-level block and for one in a row's first cell, the previous cell's
 * right edge for one in any later cell. The rule reads only the space to the
 * block's own left, so it holds however many cells a row grows to. A lane too
 * narrow for the row stacks the two buttons instead of widening the reach into
 * the neighbour, and a stacked row is always over someone else's content: it
 * covers the splitter lane, which is the only place a narrow lane can be.
 */
export function chromeRowGeometry(input: {
  blockLeft: number;
  rootLeft: number;
  /** Defaults to the page margin, which is the lane of every block that has one. */
  laneLeft?: number;
}): ChromeRow {
  const laneLeft = input.laneLeft ?? chromeMinLeft(input.rootLeft);
  const stacked = input.blockLeft - laneLeft < CHROME_WIDTH + CHROME_TEXT_GAP;
  const width = stacked ? CHROME_STACK_WIDTH : CHROME_WIDTH;
  const left = input.blockLeft - width - CHROME_TEXT_GAP;
  return {
    left,
    width,
    height: stacked ? CHROME_STACK_HEIGHT : CHROME_HEIGHT,
    overContent: stacked || left + width > input.rootLeft,
    stacked,
  };
}
