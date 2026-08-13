import type { Node as PMNode } from 'prosemirror-model';

import { isCalloutNode } from './callout-icon';

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
 * The leftmost x the chrome may be drawn at: the page's own margin and no
 * further. Shared with the hover band, which has to cover everywhere the row
 * can land or the chrome dies under the pointer that is reaching for it.
 */
export function chromeMinLeft(rootLeft: number): number {
  return rootLeft - LANE_WIDTH;
}

/** How wide the row is with `buttons` in it. */
function chromeRowWidth(buttons: number): number {
  return buttons * CHROME_BUTTON_SIZE + Math.max(0, buttons - 1) * CHROME_BUTTON_GAP;
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
 * The row is right-aligned against the block so the grip lands in the same place
 * whatever else is in the row, then clamped into the page's margin: three
 * buttons are wider than that margin, and left unclamped the row would start
 * outside the pane, over the split divider or the window edge.
 *
 * `rootLeft` is the document's own left edge. Anything drawn at or past it is on
 * the page rather than in the margin, whether that is the block's own leading
 * padding (the clamp bit) or the neighbouring cell's text (a block in the
 * right-hand column of a two-column row), and both read as a row printed over
 * the prose unless it is opaque.
 */
export function chromeRowGeometry(input: {
  blockLeft: number;
  rootLeft: number;
  buttons: number;
}): ChromeRow {
  const width = chromeRowWidth(input.buttons);
  const left = Math.max(input.blockLeft - width - CHROME_TEXT_GAP, chromeMinLeft(input.rootLeft));
  return { left, width, overContent: left + width > input.rootLeft };
}

/** How many buttons the row draws for a block. A callout earns a third, for its glyph. */
export function chromeButtonCount(node: PMNode): number {
  return isCalloutNode(node) ? 3 : 2;
}
