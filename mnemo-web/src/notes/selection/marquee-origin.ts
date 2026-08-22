/**
 * Which presses the block marquee answers to.
 *
 * The editable root is the line that matters. A press inside it is the browser's
 * text selection for as long as the button is held, however many blocks the drag
 * crosses; a press outside it is a marquee. Nothing changes its mind mid-drag,
 * because taking a text drag away from the engine once it has started is not
 * something WebView2 and WebKitGTK do alike, and the half that keeps extending
 * paints its selection under the block bands.
 */

/**
 * Surfaces with a gesture of their own. The editable root is here because text
 * selection is that gesture; the rest are chrome, a table's own rectangle drag,
 * and the column splitter's resize.
 */
const CLAIMED = [
  '.ProseMirror',
  'button',
  'a',
  'input',
  'textarea',
  '[role="menuitem"]',
  '.notes-table',
  '.notes-column-splitter',
].join(', ');

/** Whether a pointer-down on `target` starts a block marquee. */
export function isMarqueeOrigin(target: EventTarget | null): target is HTMLElement {
  if (!(target instanceof HTMLElement)) return false;
  return target.closest(CLAIMED) === null;
}
