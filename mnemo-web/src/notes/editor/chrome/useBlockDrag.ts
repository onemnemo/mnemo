import { useCallback, useRef } from 'react';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';

import { usePointerDrag, type DragPress, type Point, type PointerDrag } from '@/lib/dnd/usePointerDrag';

import { ensureRealized } from '../pipeline/ensure-realized';
import { measureColumnRows } from '../pipeline/measure-column-rows';
import { DROP_LINE_HEIGHT, resolveBlockReorder, type BlockRow } from '../pipeline/resolve-block-reorder';
import { holdsTwoColumn, insideTable, resolveBlockSplit, splitRowOf, type SplitRow, type SplitSide } from '../pipeline/resolve-block-split';
import {
  resolveColumnDrop,
  sameBlockDropTarget,
  stickyIndex,
  type BlockDropTarget,
  type DragSource,
  type PreviousSlot,
} from '../pipeline/resolve-column-drop';
import {
  extractBlockTransaction,
  moveBlockIntoCellTransaction,
  moveBlockTransaction,
  splitBlockIntoColumnsTransaction,
} from './block-move';

/**
 * The note-block side of {@link usePointerDrag}: measure the blocks on screen,
 * resolve where the drag would land, and commit it as one transaction.
 *
 * All of the pointer machinery - the two thresholds, the ghost, Escape, pointer
 * loss, the swallowed trailing click, edge auto-scroll - is the shared hook. This
 * supplies only what a note knows: where the blocks are and how to move one.
 *
 * Three kinds of landing, checked in order. The side bands of a top-level block wrap
 * it and the dragged block into a new two-column. A pointer over a two-column lands
 * in the lane under it. Anywhere else the drop is a top-level gap.
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
  | { kind: 'extract'; pos: number; sid: string; insertIndex: number }
  | { kind: 'nest'; pos: number; sid: string; cellPos: number; cellSid: string; childIndex: number }
  | { kind: 'split'; pos: number; sid: string; targetPos: number; targetSid: string; side: SplitSide };

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
  /** The same blocks with their extent and identity, for the edge split. */
  splitRows: SplitRow[];
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
export function measure(view: EditorView, pointerY: number): Measurement {
  const doc = view.state.doc;
  const root = view.dom;
  const count = Math.min(root.children.length, doc.childCount);
  if (count === 0) return { rows: [], splitRows: [], left: 0, width: 0 };

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

  const first = collected[0];
  // An anchor that misses, such as between blocks, falls back to an off-screen block.
  if (!first) return { rows: [], splitRows: [], left: 0, width: 0 };

  const rows = collected.map((row) => ({ index: row.index, top: row.top, bottom: row.bottom }));
  let pos = posOfChild(view, first.index);
  const splitRows = collected.map((row) => {
    const node = doc.child(row.index);
    const splitRow = splitRowOf(node, pos, row);
    pos += node.nodeSize;
    return splitRow;
  });
  return { rows, splitRows, left: first.left, width: first.width };
}

/** Position before the block at `index`. */
function posOfChild(view: EditorView, index: number): number {
  const doc = view.state.doc;
  let pos = 0;
  for (let i = 0; i < index; i++) pos += doc.child(i).nodeSize;
  return pos;
}

/** The dragged block as the column resolver sees it: its range, and its cell and index there. */
function dragSource(doc: PMNode, handle: BlockDragHandle): DragSource {
  const node = doc.nodeAt(handle.pos);
  const $pos = doc.resolve(handle.pos);
  const inCell = $pos.depth > 0 && $pos.parent.type.name === 'columnGroup';
  return {
    pos: handle.pos,
    end: handle.pos + (node?.nodeSize ?? 0),
    cellPos: inCell ? $pos.before($pos.depth) : null,
    // The cell's line sits at node index 0, so the block-child index is one less.
    cellIndex: inCell ? $pos.index($pos.depth) - 1 : null,
  };
}

/** Where the drag would land: the edge split, then the column lanes, then the page gaps. `slot` is the last slot shown. */
export function resolveBlockDrop(
  view: EditorView,
  pointer: Point,
  handle: BlockDragHandle,
  pressX: number,
  slot: { current: PreviousSlot | null },
): BlockDropTarget | null {
  const doc = view.state.doc;
  const { rows, splitRows, left, width } = measure(view, pointer.y);

  const source = dragSource(doc, handle);
  const node = doc.nodeAt(handle.pos);
  const sourceType = node?.type.name ?? '';
  const inTable = insideTable(doc, handle.pos);
  const holdsLayout = node ? holdsTwoColumn(node) : false;
  const split = resolveBlockSplit({ rows: splitRows, pointer, pressX, source: { ...source, type: sourceType, inTable, holdsLayout } });
  if (split) {
    slot.current = null;
    return split;
  }

  if (rows.length > 0) {
    const columns = measureColumnRows(view, rows[0].index, rows[rows.length - 1].index);
    const inColumns =
      columns.length > 0
        ? resolveColumnDrop({ rows: columns, pointer, source, previous: slot.current })
        : null;
    if (inColumns) {
      const target = inColumns.kind === 'cell' ? inColumns : null;
      slot.current = target ? { cellPos: target.cellPos, insertIndex: target.insertIndex } : null;
      return target;
    }
  }

  const target = resolveBlockReorder({
    rows,
    blockCount: doc.childCount,
    sourceIndex: handle.index,
    pointerY: pointer.y,
    left,
    width,
    previousInsertIndex: stickyIndex(slot.current, null),
  });
  slot.current = target ? { cellPos: null, insertIndex: target.insertIndex } : null;
  if (!target) return null;

  // Realize an off-screen boundary block so the drop line reads its real top.
  if (target.insertIndex < doc.childCount && !rows.some((row) => row.index === target.insertIndex)) {
    const realized = ensureRealized(view, posOfChild(view, target.insertIndex));
    if (realized) {
      return { kind: 'gap', ...target, line: { ...target.line, top: realized.rect.top - DROP_LINE_HEIGHT / 2 } };
    }
  }
  return { kind: 'gap', ...target };
}

export function useBlockDrag(view: EditorView | null): PointerDrag<BlockDragHandle, BlockDropTarget> {
  // The last slot shown, for the sticky middle band; reset each press so a
  // previous drag cannot make the first middle-band entry of the next one stick.
  const previousSlot = useRef<PreviousSlot | null>(null);
  const pressX = useRef(0);

  const resolve = useCallback(
    (pointer: Point, handle: BlockDragHandle): BlockDropTarget | null =>
      view ? resolveBlockDrop(view, pointer, handle, pressX.current, previousSlot) : null,
    [view],
  );

  const drag = usePointerDrag<BlockDragHandle, BlockDropTarget, DropPlan>({
    getKey: (handle) => handle.sid,
    ghost: { offset: { x: 24, y: 14 }, tiltDeg: -1.5 },
    autoScroll: view ? { container: () => findScrollParent(view.dom), zone: 40, minStep: 9, maxStep: 18 } : undefined,
    // The line's Y as well as the slot: a scroll moves the boundary under a held
    // pointer without changing which slot it is, and the indicator has to follow.
    sameTarget: sameBlockDropTarget,
    resolve,
    plan: (handle, target) => {
      if (target.kind === 'split') {
        return {
          kind: 'split',
          pos: handle.pos,
          sid: handle.sid,
          targetPos: target.pos,
          targetSid: target.sid,
          side: target.side,
        };
      }
      if (target.kind === 'cell') {
        return {
          kind: 'nest',
          pos: handle.pos,
          sid: handle.sid,
          cellPos: target.cellPos,
          cellSid: target.cellSid,
          childIndex: target.moveTo,
        };
      }
      return handle.index !== null
        ? { kind: 'move', sourceIndex: handle.index, moveTo: target.moveTo }
        : { kind: 'extract', pos: handle.pos, sid: handle.sid, insertIndex: target.moveTo };
    },
    onDrop: (planned) => {
      if (!view) return;
      const tr =
        planned.kind === 'move'
          ? moveBlockTransaction(view.state, planned.sourceIndex, planned.moveTo)
          : planned.kind === 'extract'
            ? extractBlockTransaction(view.state, planned.pos, planned.sid, planned.insertIndex)
            : planned.kind === 'split'
              ? splitBlockIntoColumnsTransaction(
                  view.state,
                  planned.pos,
                  planned.sid,
                  planned.targetPos,
                  planned.targetSid,
                  planned.side,
                )
              : moveBlockIntoCellTransaction(
                  view.state,
                  planned.pos,
                  planned.sid,
                  planned.cellPos,
                  planned.cellSid,
                  planned.childIndex,
                );
      if (tr) view.dispatch(tr);
    },
  });

  const press = useCallback(
    (event: DragPress, handle: BlockDragHandle) => {
      previousSlot.current = null;
      pressX.current = event.clientX;
      drag.press(event, handle);
    },
    [drag],
  );

  return { ...drag, press };
}
