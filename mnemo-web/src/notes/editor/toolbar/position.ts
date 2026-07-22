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

/** The desktop's two anchor offsets: 8px of air above the line, 4px below it. */
const GUTTER_ABOVE = 8;
const GUTTER_BELOW = 4;
const EDGE_MARGIN = 4;

/** Keeps a value inside [min, max], and inside min when the two have crossed. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export function placeToolbar(anchor: Rect, size: Size, viewport: Size): Placement {
  const showAbove = anchor.top >= MIN_ABOVE_SPACE;
  const preferredTop = showAbove
    ? anchor.top - size.height - GUTTER_ABOVE
    : anchor.bottom + GUTTER_BELOW;

  // Both axes are clamped for the same reason: a bubble that hangs off the
  // viewport is a control the user cannot reach. Vertically that happens with a
  // short window or a toolbar taller than the room the flip assumed.
  const top = clamp(preferredTop, EDGE_MARGIN, viewport.height - size.height - EDGE_MARGIN);

  const center = (anchor.left + anchor.right) / 2;
  const left = clamp(center - size.width / 2, EDGE_MARGIN, viewport.width - size.width - EDGE_MARGIN);

  return { top, left, showAbove };
}
