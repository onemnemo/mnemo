/**
 * Bring a match into view, even when its block has never been on screen.
 *
 * Off-screen blocks are skipped by `content-visibility: auto`, so a block the
 * reader has never scrolled to is laid out only against its reserved estimate
 * and its real geometry is unknown. Scrolling straight to it would land on the
 * estimate, which runs over the truth, so the match would sit a little off.
 *
 * The fix is the shared `ensureRealized` helper, reused rather than reinvented:
 * scrolling the block toward the viewport and reading its geometry forces the
 * engine to lay the skipped subtree out for real. Once it is realized, the exact
 * hit position can be measured with `coordsAtPos` and scrolled into view, so a
 * hit near the bottom of a tall block converges on its own position rather than
 * on the block's top edge.
 *
 * DOM focus deliberately stays in the find box. Highlighting the current match
 * is the decoration's job and scrolling is this function's; moving the editor
 * selection would pull focus out of the search field and break typing the next
 * query or pressing Enter to step to the next hit. This is the browser-find and
 * code-editor idiom, and a deliberate divergence from the desktop, which moved
 * the caret into the match.
 */

import type { EditorView } from 'prosemirror-view';
import { ensureRealized } from '../editor/pipeline/ensure-realized';
import type { FindMatch } from './search';

/** Keep the hit this far from the viewport edge so it is comfortably visible. */
const SCROLL_MARGIN = 80;

/** The nearest scrollable ancestor, or null to fall back to the window. */
function scrollParentOf(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement;
  while (node) {
    const style = getComputedStyle(node);
    if (/(auto|scroll|overlay)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

export function scrollToMatch(view: EditorView, match: FindMatch): void {
  // Realize the block and bring it roughly on screen. Reading its geometry forces
  // the engine to lay out a content-visibility-skipped subtree, so the coords
  // below are measured against real layout rather than the reserved estimate.
  const realized = ensureRealized(view, match.from, { scroll: true });
  if (!realized) return;

  const from = Math.min(match.from, view.state.doc.content.size);
  let coords: { top: number; bottom: number };
  try {
    coords = view.coordsAtPos(from);
  } catch {
    // A position that cannot be measured: the block scroll already did its best.
    return;
  }

  const scroller = scrollParentOf(realized.dom);
  const viewTop = scroller ? scroller.getBoundingClientRect().top : 0;
  const viewBottom = scroller ? scroller.getBoundingClientRect().bottom : window.innerHeight;

  let delta = 0;
  if (coords.top < viewTop + SCROLL_MARGIN) delta = coords.top - (viewTop + SCROLL_MARGIN);
  else if (coords.bottom > viewBottom - SCROLL_MARGIN) delta = coords.bottom - (viewBottom - SCROLL_MARGIN);

  if (delta !== 0) {
    if (scroller) scroller.scrollTop += delta;
    else window.scrollBy(0, delta);
  }
}
