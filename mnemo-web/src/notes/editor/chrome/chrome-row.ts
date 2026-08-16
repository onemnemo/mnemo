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

/** The add-below button and the grip. Every block draws the same row. */
const CHROME_WIDTH = 2 * CHROME_BUTTON_SIZE + CHROME_BUTTON_GAP;

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
  /** The row reaches into the document column, so it needs an opaque backing to stay readable. */
  overContent: boolean;
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
 */
export function chromeRowGeometry(input: { blockLeft: number; rootLeft: number }): ChromeRow {
  const left = input.blockLeft - CHROME_WIDTH - CHROME_TEXT_GAP;
  return { left, width: CHROME_WIDTH, overContent: left + CHROME_WIDTH > input.rootLeft };
}
