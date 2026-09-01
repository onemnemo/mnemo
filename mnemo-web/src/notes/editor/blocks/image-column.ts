/**
 * The column an image block's width is a fraction of.
 *
 * The figure hugs its picture, so the figure cannot answer this about itself: a preset read off
 * it would make 50 percent halve the picture on every click, and a drag ceiling read off it could
 * never grow the picture at all. The figure's parent is the box a full-width block fills, which is
 * the editable root for a top-level block and a cell for one inside a two-column row, so this holds
 * at any nesting depth without naming a container.
 *
 * One helper, because the preset and the drag ceiling have to agree: a picture dragged to the right
 * edge and a picture set to 100 percent are the same width or the two rows contradict each other.
 */

import type { EditorView } from 'prosemirror-view';

/** A computed length in pixels, and zero for anything a style engine leaves unset. */
function px(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** The content width of the box `figure` is laid out in, its padding and border taken off. */
export function imageColumnWidth(figure: HTMLElement | null): number {
  const column = figure?.parentElement ?? null;
  if (column === null) return 0;
  const outer = column.getBoundingClientRect().width;
  if (outer <= 0) return 0;
  const style = getComputedStyle(column);
  const inset =
    px(style.paddingLeft) + px(style.paddingRight) + px(style.borderLeftWidth) + px(style.borderRightWidth);
  return Math.max(0, outer - inset);
}

/** The same measurement for the image block at `pos`, for a caller that holds a position. */
export function imageColumnWidthAt(view: EditorView, pos: number): number {
  const dom = view.nodeDOM(pos);
  return dom instanceof HTMLElement ? imageColumnWidth(dom) : 0;
}
