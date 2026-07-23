import { useCallback, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { EditorView } from 'prosemirror-view';

import { usePointerDrag, type Point, type PointerDrag } from '@/lib/dnd/usePointerDrag';

import { ensureRealized } from '../pipeline/ensure-realized';
import {
  DROP_LINE_HEIGHT,
  resolveBlockReorder,
  type BlockRow,
  type ReorderTarget,
} from '../pipeline/resolve-block-reorder';
import { extractBlockTransaction, moveBlockTransaction } from './block-move';

/**
 * The note-block side of {@link usePointerDrag}: measure the top-level blocks,
 * resolve a vertical reorder, and commit it as one transaction.
 *
 * All of the pointer machinery - the two thresholds, the ghost, Escape, pointer
 * loss, the swallowed trailing click, edge auto-scroll - is the shared hook. This
 * supplies only what a note knows: where the blocks are and how to move one.
 *
 * Two kinds of source, one drop model. A top-level block moves between the
 * document's child gaps. A block nested in a two-column cell drags by the same
 * handle but *extracts*: it leaves its cell and lands in the chosen top-level
 * gap, the way the desktop's per-cell grips and Notion's drag-out both read.
 * Dropping *into* a column is out of scope here; the drop gaps here are
 * top-level boundaries only.
 */

export interface BlockDragHandle {
  /**
   * Document-child index at drag start for a top-level block, or null for a
   * nested one; the document does not change during a drag.
   */
  index: number | null;
  /** Position before the block, for realizing it and reading its geometry. */
  pos: number;
  sid: string;
  /** Human label for the drag ghost, e.g. "Heading 1". */
  label: string;
}

type DropPlan =
  | { kind: 'move'; sourceIndex: number; moveTo: number }
  | { kind: 'extract'; pos: number; sid: string; insertIndex: number };

/** Measure a little past the fold so a boundary just off screen is still honest. */
const VIEWPORT_MARGIN = 200;

function findScrollParent(el: HTMLElement): HTMLElement | Window {
  let node = el.parentElement;
  while (node) {
    const style = getComputedStyle(node);
    if (/(auto|scroll|overlay)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) return node;
    node = node.parentElement;
  }
  return window;
}

interface Measurement {
  rows: BlockRow[];
  left: number;
  width: number;
}

/** Whether a block's rect is close enough to the viewport to matter for a drop. */
function nearViewport(rect: DOMRect, viewportHeight: number): boolean {
  return rect.bottom >= -VIEWPORT_MARGIN && rect.top <= viewportHeight + VIEWPORT_MARGIN;
}

/**
 * A block on screen at the pointer's height, as an anchor to expand from. Found
 * by hit-testing the note column at the pointer's Y, so it costs one lookup
 * rather than a walk over every block. Falls back to the last block for the empty
 * space under a short document.
 */
function anchorIndex(view: EditorView, count: number, pointerY: number): number {
  const rootRect = view.dom.getBoundingClientRect();
  const probeX = rootRect.left + Math.min(24, Math.max(4, rootRect.width / 2));
  const probeY = Math.min(Math.max(pointerY, 0), window.innerHeight - 1);
  let el = document.elementFromPoint(probeX, probeY);
  while (el && el.parentElement !== view.dom) el = el.parentElement;
  if (el instanceof HTMLElement && el.parentElement === view.dom) {
    const index = Array.prototype.indexOf.call(view.dom.children, el);
    if (index >= 0 && index < count) return index;
  }
  return count - 1;
}

/**
 * The on-screen top-level blocks, in document order, plus the note column's left
 * and width for the drop line.
 *
 * Bounded to the visible run: it hit-tests the block at the pointer, then expands
 * up and down until a block falls outside the viewport margin. It never touches
 * the off-screen remainder, so the cost is the number of blocks on screen rather
 * than the document size - the difference between a smooth drag and a frozen one
 * in a tens-of-thousands-block note. A drop heading past the fold auto-scrolls the
 * next blocks into view, which brings them into this window.
 */
function measure(view: EditorView, pointerY: number): Measurement {
  const doc = view.state.doc;
  const root = view.dom;
  const count = Math.min(root.children.length, doc.childCount);
  if (count === 0) return { rows: [], left: 0, width: 0 };

  const viewportHeight = window.innerHeight;
  const anchor = anchorIndex(view, count, pointerY);

  const collected: { index: number; top: number; bottom: number; left: number; width: number }[] = [];
  // Upward from the anchor while blocks stay near the viewport. Contiguity holds
  // because blocks are laid out top to bottom in document order.
  for (let i = anchor; i >= 0; i--) {
    const el = root.children[i];
    if (!(el instanceof HTMLElement)) break;
    const rect = el.getBoundingClientRect();
    if (!nearViewport(rect, viewportHeight)) break;
    collected.push({ index: i, top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width });
  }
  collected.reverse();
  // Downward from just past the anchor.
  for (let i = anchor + 1; i < count; i++) {
    const el = root.children[i];
    if (!(el instanceof HTMLElement)) break;
    const rect = el.getBoundingClientRect();
    if (!nearViewport(rect, viewportHeight)) break;
    collected.push({ index: i, top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width });
  }

  const rows = collected.map((row) => ({ index: row.index, top: row.top, bottom: row.bottom }));
  const first = collected[0];
  return { rows, left: first?.left ?? 0, width: first?.width ?? 0 };
}

/** Position before the block at `index`. */
function posOfChild(view: EditorView, index: number): number {
  const doc = view.state.doc;
  let pos = 0;
  for (let i = 0; i < index; i++) pos += doc.child(i).nodeSize;
  return pos;
}

export function useBlockDrag(view: EditorView | null): PointerDrag<BlockDragHandle, ReorderTarget> {
  // The last insert index shown, for the sticky middle band; reset each press so a
  // previous drag cannot make the first middle-band entry of the next one stick.
  const previousInsertIndex = useRef<number | null>(null);

  const resolve = useCallback(
    (pointer: Point, handle: BlockDragHandle): ReorderTarget | null => {
      if (!view) return null;
      const doc = view.state.doc;
      const { rows, left, width } = measure(view, pointer.y);

      const target = resolveBlockReorder({
        rows,
        blockCount: doc.childCount,
        sourceIndex: handle.index,
        pointerY: pointer.y,
        left,
        width,
        previousInsertIndex: previousInsertIndex.current,
      });
      previousInsertIndex.current = target ? target.insertIndex : null;
      if (!target) return null;

      // The boundary block sits off screen (a drop toward the fold): realize it so
      // the drop line reads its real top rather than a reserved-height estimate.
      if (target.insertIndex < doc.childCount && !rows.some((row) => row.index === target.insertIndex)) {
        const realized = ensureRealized(view, posOfChild(view, target.insertIndex));
        if (realized) {
          return { ...target, line: { ...target.line, top: realized.rect.top - DROP_LINE_HEIGHT / 2 } };
        }
      }
      return target;
    },
    [view],
  );

  const drag = usePointerDrag<BlockDragHandle, ReorderTarget, DropPlan>({
    getKey: (handle) => handle.sid,
    ghost: { offset: { x: 24, y: 14 }, tiltDeg: -1.5 },
    autoScroll: view ? { container: () => findScrollParent(view.dom), zone: 40, minStep: 9, maxStep: 18 } : undefined,
    // The line's Y as well as the gap: a scroll moves the boundary under a held
    // pointer without changing which gap it is, and the indicator has to follow.
    sameTarget: (a, b) => a?.insertIndex === b?.insertIndex && a?.line.top === b?.line.top,
    resolve,
    plan: (handle, target) =>
      handle.index !== null
        ? { kind: 'move', sourceIndex: handle.index, moveTo: target.moveTo }
        : { kind: 'extract', pos: handle.pos, sid: handle.sid, insertIndex: target.moveTo },
    onDrop: (planned) => {
      if (!view) return;
      const tr =
        planned.kind === 'move'
          ? moveBlockTransaction(view.state, planned.sourceIndex, planned.moveTo)
          : extractBlockTransaction(view.state, planned.pos, planned.sid, planned.insertIndex);
      if (tr) view.dispatch(tr);
    },
  });

  const press = useCallback(
    (event: ReactPointerEvent, handle: BlockDragHandle) => {
      previousInsertIndex.current = null;
      drag.press(event, handle);
    },
    [drag],
  );

  return { ...drag, press };
}
