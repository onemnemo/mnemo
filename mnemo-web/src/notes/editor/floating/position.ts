/**
 * Placement math for the editor's floating chrome, kept pure and separate from
 * the DOM measurement that feeds it, `EditorView.coordsAtPos` and
 * `getBoundingClientRect` return meaningless zeros under jsdom, so the decision
 * logic has to be testable without either.
 *
 * Three placements, because they differ on purpose. The formatting toolbar is
 * centred on the selection and prefers to sit above it, where the reader's eye
 * already is. The slash menu is left-aligned to the caret and prefers to sit
 * below, because it is a list being read downward and the text above it is the
 * context the user is typing into. The colour popover hangs off the toolbar
 * rather than off the text, so it is placed against that instead.
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

/** Desktop's slash-menu `HeightEstimate`, the room a full list wants below. */
export const MENU_HEIGHT_ESTIMATE = 320;

/** The desktop anchors the menu 4px off the line on whichever side it takes. */
const MENU_GUTTER = 4;

export interface MenuPlacement extends Placement {
  /**
   * The room the chosen side actually has. The caller caps the menu to it so a
   * list too tall to fit scrolls instead of being pushed over the line it is
   * anchored to, which is the line the user is typing in.
   */
  readonly maxHeight: number;
}

/**
 * Places a list anchored to the caret: below by default, above only when below
 * cannot hold it and above has more room. Left-aligned to the anchor rather
 * than centred, so the rows line up with the text being typed.
 *
 * Height is decided here rather than left to CSS because the two answers depend
 * on each other: how tall the menu may be depends on the side it takes, and
 * where its top goes depends on how tall it ended up.
 */
export function placeMenu(anchor: Rect, size: Size, viewport: Size): MenuPlacement {
  const roomAbove = anchor.top - MENU_GUTTER - EDGE_MARGIN;
  const roomBelow = viewport.height - anchor.bottom - MENU_GUTTER - EDGE_MARGIN;
  const showAbove = roomBelow < MENU_HEIGHT_ESTIMATE && roomAbove > roomBelow;

  // Never negative: a caret pressed against an edge has no room on that side,
  // and a negative cap would read as "no constraint" once written to CSS.
  const maxHeight = Math.max(0, showAbove ? roomAbove : roomBelow);
  const height = Math.min(size.height, maxHeight);

  const preferredTop = showAbove ? anchor.top - height - MENU_GUTTER : anchor.bottom + MENU_GUTTER;
  const top = clamp(preferredTop, EDGE_MARGIN, viewport.height - height - EDGE_MARGIN);
  const left = clamp(anchor.left, EDGE_MARGIN, viewport.width - size.width - EDGE_MARGIN);

  return { top, left, showAbove, maxHeight };
}

/** The air the CSS leaves between the toolbar and a panel hanging off it. */
const POPOVER_GUTTER = 6;

export interface PopoverPlacement {
  /**
   * Where the panel's left edge goes, measured from the anchor's own left
   * rather than the viewport's. The popover is drawn inside the toolbar, so it
   * follows every move the toolbar makes without being placed again.
   */
  readonly left: number;
  readonly showAbove: boolean;
}

/**
 * Places a panel against the toolbar that opened it, rather than against the
 * text. The toolbar has already been kept on screen; this keeps the panel on
 * screen too, which the toolbar's own placement knows nothing about because it
 * measured itself while the panel was still hidden.
 *
 * Below by default, which is where a panel opened from a button is looked for,
 * and above only when below cannot hold it. No height cap, unlike the menu: the
 * palette is a fixed dozen cells, and a colour grid that scrolls would be worse
 * than one that flipped.
 */
export function placePopover(anchor: Rect, size: Size, viewport: Size): PopoverPlacement {
  const roomAbove = anchor.top - POPOVER_GUTTER - EDGE_MARGIN;
  const roomBelow = viewport.height - anchor.bottom - POPOVER_GUTTER - EDGE_MARGIN;
  const showAbove = roomBelow < size.height && roomAbove > roomBelow;

  const left = clamp(anchor.left, EDGE_MARGIN, viewport.width - size.width - EDGE_MARGIN);

  return { left: left - anchor.left, showAbove };
}
