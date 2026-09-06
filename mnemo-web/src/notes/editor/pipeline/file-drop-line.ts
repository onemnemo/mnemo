/**
 * The line that says where a file dropped on the note will land.
 *
 * The same indicator the block reorder drag paints, for the same reason: a drop
 * that shows nothing until it has already happened puts the block at a place the
 * reader was never offered.
 *
 * The boundary is worked out from the drop position the way the insert works it
 * out, so the line cannot promise a gap the release does not use. The element's
 * look is the stylesheet's `.notes-drop-line`; only geometry is written here.
 */

import type { Node as PMNode } from 'prosemirror-model';

import { DROP_LINE_HEIGHT } from './resolve-block-reorder';

export interface DropLineBox {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * The top-level block a drop at `pos` lands after, as a document-child index, or
 * -1 for the gap above the first block.
 */
export function dropRowIndex(doc: PMNode, pos: number): number {
  const clamped = Math.max(0, Math.min(pos, doc.content.size));
  const $pos = doc.resolve(clamped);
  // Depth zero is already a gap between two top-level blocks, so the block it
  // follows is the one before it. Anything deeper is inside a block, and the
  // insert puts the new one after that block.
  return $pos.depth === 0 ? $pos.index(0) - 1 : $pos.index(0);
}

/** Where to draw the line for that gap, in viewport coordinates. */
export function dropLineBox(root: HTMLElement, rowIndex: number): DropLineBox | null {
  const count = root.children.length;
  if (count === 0) return null;
  const index = Math.min(Math.max(rowIndex, 0), count - 1);
  const el = root.children[index];
  if (!(el instanceof HTMLElement)) return null;
  const rect = el.getBoundingClientRect();
  // Above the first block for the one gap that has no block before it.
  const edge = rowIndex < 0 ? rect.top : rect.bottom;
  return {
    top: edge - DROP_LINE_HEIGHT / 2,
    left: rect.left,
    width: rect.width,
    height: DROP_LINE_HEIGHT,
  };
}

export interface DropLine {
  show(box: DropLineBox): void;
  hide(): void;
  destroy(): void;
}

/**
 * The line's element, built on the first move of a drag that wants one and gone
 * again once the drag is: the moves inside one drag arrive by the dozen and only
 * reposition it. A note with nothing being dragged over it owns no element.
 */
export function createDropLine(): DropLine {
  let el: HTMLElement | null = null;

  return {
    show(box) {
      if (!el) {
        el = document.createElement('div');
        el.className = 'notes-drop-line';
        el.setAttribute('aria-hidden', 'true');
        document.body.appendChild(el);
      }
      el.style.top = `${String(box.top)}px`;
      el.style.left = `${String(box.left)}px`;
      el.style.width = `${String(box.width)}px`;
      el.style.height = `${String(box.height)}px`;
    },
    hide() {
      el?.remove();
      el = null;
    },
    destroy() {
      el?.remove();
      el = null;
    },
  };
}
