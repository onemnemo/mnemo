import { PEEK_CANVAS_STRIP, PEEK_MIN_WIDTH } from "./store"

export interface OverlayGeometry {
  /** The panel's width. */
  readonly width: number
  /** How far the panel sits in from the row edge it hangs on, so it clears the dock. */
  readonly inset: number
}

/**
 * Where an overlaying peek sits in its row.
 *
 * The row holds the canvas and, when open, the assistant dock, which the panel insets
 * past rather than covers. The strip of canvas an overlay leaves showing is all or
 * nothing: a ribbon a few pixels wide is the outcome the strip exists to prevent, so once
 * the canvas cannot hold the panel and a strip, the panel takes the whole canvas. And
 * once the canvas cannot hold even the panel's minimum, the panel keeps its minimum and
 * covers as much of the dock as that takes: a few pixels of panel is no panel, and the
 * dock is the one thing in the row that can give. Before the row is measured, the
 * stored width stands.
 */
export function overlayGeometry(row: number, neighbour: number, width: number): OverlayGeometry {
  if (row === 0) return { width, inset: neighbour }

  const canvas = Math.max(0, row - neighbour)
  if (canvas - PEEK_CANVAS_STRIP >= PEEK_MIN_WIDTH) {
    return { width: Math.min(width, canvas - PEEK_CANVAS_STRIP), inset: neighbour }
  }

  const shown = Math.min(Math.max(canvas, PEEK_MIN_WIDTH), row)
  return { width: shown, inset: Math.max(0, Math.min(neighbour, row - shown)) }
}
