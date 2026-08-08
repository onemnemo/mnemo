// Pixel constants for the overview widget board, mirroring Mnemo.UI OverviewBoardMetrics. The board
// is a responsive auto-flow grid: the column count derives from the available width, cells stretch
// horizontally, and rows have a fixed height. The packing math itself lives in engine.ts.

/** Maximum number of columns (wide layout). Below this the board switches algorithm, not just size. */
export const MAX_COLUMNS = 4

/** Height of one grid row in pixels. Fixed, never intrinsic: content does not grow a row. */
export const ROW_HEIGHT = 120

/** Gap between cells in pixels, both axes. */
export const GAP = 16

/**
 * Stand-in width for a board that has not been measured yet. A ResizeObserver's first callback can
 * legitimately report 0, and laying that out as a 1-column board would collapse and then re-flow
 * the whole grid one frame later. The desktop's WidgetBoardPanel.FallbackWidth does the same.
 *
 * Lives here because both consumers, computeLayout's width guard and the drag layer's cell-width
 * guard, are board metric decisions.
 */
export const FALLBACK_WIDTH = 1200

/** Responsive column count: 4 (wide) then 2 (medium) then 1 (narrow). */
export function columnCountForWidth(width: number): number {
  if (width >= 1024) return MAX_COLUMNS
  if (width >= 560) return 2
  return 1
}

/**
 * Usable width of one column, once the inter-column gaps are taken out.
 *
 * Shared because two callers need it and they were disagreeing: the layout pass subtracted the
 * gaps before dividing and the drag targeting divided the raw width. On a four-column board that
 * is 12px per column, so a drag begun before the first measure aimed at a grid wider than the one
 * being drawn and every column past the first landed short.
 */
export function cellWidthFor(boardWidth: number, columnCount: number): number {
  const columns = Math.max(1, columnCount)
  return Math.max(0, (boardWidth - (columns - 1) * GAP) / columns)
}

/** The cell width a board gets before anything has measured it. */
export function fallbackCellWidth(columnCount: number): number {
  return cellWidthFor(FALLBACK_WIDTH, columnCount)
}
