/**
 * Force an accurate layout of the top-level block containing a document position
 * before its on-screen rectangle is read.
 *
 * Every top-level block carries `content-visibility: auto` (see `intrinsic-size`
 * and `notes-editor.css`), so a block the reader has never scrolled to is laid
 * out only against its reserved `contain-intrinsic-size`, and its DOM rect is an
 * estimate rather than the truth. Any code that maps a document position to
 * screen coordinates - a drop line at a block boundary, a find hit, the outline
 * chip, an AI jump to a sid - has to realize the block first or it measures the
 * guess.
 *
 * This is the one place that does it. It is deliberately not part of the reorder:
 * find/replace and the outline chip need exactly this and must call the same
 * helper rather than reinventing it.
 *
 * ## Why not a NodeView shell toggle
 *
 * The shelling design that `ensureRealized` was first written for was
 * dropped: blocks are permanently-realized NodeViews and off-screen ones are only
 * `content-visibility`-skipped, never removed from the DOM. So realizing a block
 * is not a shell/realize state change; it is forcing the engine to lay out a
 * skipped subtree. Reading a geometry property is what does that. Crucially the
 * read must not *write* to a `view.dom` descendant - a bare style mutation there
 * looks like an external edit to ProseMirror's own MutationObserver and tears
 * down neighbouring NodeViews - so this only ever reads.
 */

import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';

export interface RealizedBlock {
  /** Position just before the top-level block (its `nodeDOM` anchor). */
  readonly pos: number;
  /** The block's index among the document's direct children. */
  readonly index: number;
  readonly node: PMNode;
  readonly dom: HTMLElement;
  /** The block's viewport rect, read after layout was forced. */
  readonly rect: DOMRect;
}

export interface EnsureRealizedOptions {
  /**
   * Scroll the block into view before measuring. Off by default: the reorder
   * must never move the viewport under a held pointer. Find/replace and the
   * outline chip, which are taking the reader to the block anyway, pass `true`
   * for a rect that is exact rather than best-available.
   */
  readonly scroll?: boolean;
}

/**
 * Locate the top-level block whose range contains `pos`, without touching the DOM.
 *
 * A position exactly on a block boundary, or past the end, resolves to the
 * nearest real block rather than off the end of the document.
 */
export function topLevelBlockAt(view: EditorView, pos: number): { pos: number; index: number; node: PMNode } | null {
  const doc = view.state.doc;
  if (doc.childCount === 0) return null;

  const clamped = Math.max(0, Math.min(pos, doc.content.size));
  const $pos = doc.resolve(clamped);
  // index(0) is the child the position sits in, or the child after it when the
  // position is between blocks; clamp so the tail boundary maps to the last block.
  const childIndex = $pos.index(0);
  const index = Math.min(childIndex, doc.childCount - 1);

  // `$pos` already resolved the child at `index`, so `before(1)` is that work
  // reused rather than redone. Past the last child there is no child left to
  // resolve into, depth 0 has nothing for `before(1)` to name there, and it
  // answers with the clamped position itself rather than the last block's
  // start, so that one case keeps the walk.
  let before: number;
  if (childIndex >= doc.childCount) {
    before = 0;
    for (let i = 0; i < index; i++) before += doc.child(i).nodeSize;
  } else {
    before = $pos.before(1);
  }
  return { pos: before, index, node: doc.child(index) };
}

/**
 * Realize the block containing `pos` and return it with a measured rect, or null
 * if the position has no block (an empty document) or the block has no HTML
 * element yet.
 */
export function ensureRealized(
  view: EditorView,
  pos: number,
  options: EnsureRealizedOptions = {},
): RealizedBlock | null {
  const located = topLevelBlockAt(view, pos);
  if (!located) return null;

  const dom = view.nodeDOM(located.pos);
  if (!(dom instanceof HTMLElement)) return null;

  if (options.scroll) dom.scrollIntoView({ block: 'nearest', inline: 'nearest' });

  // Reading geometry flushes pending layout so the rect reflects the block's real
  // flow position. For a `content-visibility: auto` block the forced read lays out
  // its contents; a block that has never been on screen still falls back to its
  // reserved height until it has been rendered once, which is close enough for a
  // line the pointer is scrolling toward, and exact once `scroll` was requested.
  const rect = dom.getBoundingClientRect();

  return { pos: located.pos, index: located.index, node: located.node, dom, rect };
}
