/**
 * Placement math for a floating box anchored to a selection, kept pure and
 * separate from the DOM measurement that feeds it, `EditorView.coordsAtPos`
 * and `getBoundingClientRect` return meaningless zeros under jsdom, so the
 * decision logic has to be testable without either.
 *
 * Mirrors the desktop toolbar's `ShouldShowAbove`: prefer sitting above the
 * selection, since that is where a reader's eye already is, and drop below
 * only when there is not {@link MIN_ABOVE_SPACE}px of room above it.
 */

export interface Rect {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Placement {
  readonly top: number;
  readonly left: number;
  readonly showAbove: boolean;
}

/** Desktop's `HeightEstimate`, the room a bubble needs to fit above the line. */
export const MIN_ABOVE_SPACE = 48;

const GUTTER = 8;
const EDGE_MARGIN = 4;

export function placeToolbar(anchor: Rect, size: Size, viewport: Size): Placement {
  const showAbove = anchor.top >= MIN_ABOVE_SPACE;
  const top = showAbove ? anchor.top - size.height - GUTTER : anchor.bottom + GUTTER;

  const center = (anchor.left + anchor.right) / 2;
  const maxLeft = viewport.width - size.width - EDGE_MARGIN;
  const left = Math.min(Math.max(center - size.width / 2, EDGE_MARGIN), Math.max(maxLeft, EDGE_MARGIN));

  return { top, left, showAbove };
}
