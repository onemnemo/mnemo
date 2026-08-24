/**
 * Suppressing the browser's own text selection for the length of a pointer drag.
 *
 * A drag that travels across the page would otherwise sweep a text selection
 * along under it. The natural `document.body.style.userSelect = "none"` does
 * nothing in WebKitGTK: its CSSOM does not honour the unprefixed property, so
 * writing it changes no computed style. Every drag guard toggles this one class
 * on the body instead, and the stylesheet rule it turns on carries the vendor
 * prefix the build adds, exactly like the rest of the app's user-select. One
 * class, one rule, shared by the block marquee, the board tile, the block reorder
 * and the dock resize.
 */

/** The body class the drag guards toggle. Its rule lives in index.css. */
export const DRAGGING_CLASS = "app-dragging"

/** Turn the browser's text selection off app-wide while a pointer drag is on. */
export function suppressTextSelection(): void {
  document.body.classList.add(DRAGGING_CLASS)
}

/** Turn it back on when the drag ends, is cancelled, or unmounts mid-gesture. */
export function restoreTextSelection(): void {
  document.body.classList.remove(DRAGGING_CLASS)
}
