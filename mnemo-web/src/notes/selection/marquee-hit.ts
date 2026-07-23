/**
 * The marquee's pure half: band geometry and the per-document row structure the
 * hit-test walks.
 *
 * The band lives in the scroll container's *content* space - an anchor captured
 * at press does not move when the document scrolls under a held pointer, which
 * is what lets the drag auto-scroll and keep everything it has covered. The
 * overlay converts to viewport space only at its edges: painting the band div,
 * and comparing against block rects (which the DOM reports in viewport space).
 *
 * Hit-testing never walks the whole document per frame. Top-level blocks are
 * laid out top to bottom in document order, so their rects are monotone in
 * index and a binary search finds the band's first and last touched rows; only
 * the rows in between are examined. Off-screen rows are hit-tested exactly like
 * visible ones - `getBoundingClientRect` reports real flow geometry (a
 * `content-visibility` block that has never rendered reports its reserved
 * estimate, the same geometry the scrollbar shows) - so a selection made under
 * auto-scroll keeps the blocks that have left the viewport. That is the fix for
 * the desktop's own known flaw, which could only test realized blocks and
 * deliberately dropped the rest mid-drag.
 *
 * Inside a two-column row the unit is the cell child, not the row: each direct
 * block child of each cell is tested against the band on its own rect, the same
 * per-leaf granularity the desktop's per-EditableBlock hit-test had.
 */

import type { Node as PMNode } from 'prosemirror-model';

import type { BlockRegistry } from '../editor/registry/build';
import { containerBlockNames } from '../editor/blocks/shared';
import { walkBlocks } from '../editor/projection/document';

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface BandRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export function bandFrom(a: Point, b: Point): BandRect {
  return {
    left: Math.min(a.x, b.x),
    top: Math.min(a.y, b.y),
    right: Math.max(a.x, b.x),
    bottom: Math.max(a.y, b.y),
  };
}

export function rectsIntersect(a: BandRect, b: BandRect): boolean {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
}

/**
 * The smallest row index whose bottom reaches `y`, or `count` when none does.
 * `bottomOf` must be non-decreasing in index, which document flow guarantees.
 */
export function firstRowTouching(count: number, bottomOf: (index: number) => number, y: number): number {
  let lo = 0;
  let hi = count;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bottomOf(mid) >= y) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/**
 * The largest row index whose top is at or above `y`, or -1 when none is.
 * `topOf` must be non-decreasing in index.
 */
export function lastRowTouching(count: number, topOf: (index: number) => number, y: number): number {
  let lo = -1;
  let hi = count - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (topOf(mid) <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** One hit-testable unit inside a two-column row: a direct cell child and its subtree's sids. */
export interface MarqueeCellChild {
  /** Position of the child block node, for `view.nodeDOM`. */
  readonly pos: number;
  readonly sids: readonly string[];
}

export interface MarqueeRow {
  /** Position of the top-level block node. */
  readonly pos: number;
  /** Every selectable sid within the row, for the plain-row hit. */
  readonly sids: readonly string[];
  /**
   * For a two-column row, the cell children to hit-test individually; null for
   * a plain block, which selects as one unit.
   */
  readonly cellChildren: readonly MarqueeCellChild[] | null;
}

/**
 * The rows in document-child order, cached by document identity: a ProseMirror
 * document is immutable, so the structure is valid for the life of that object
 * and a marquee's many frames over one unchanging document build it once.
 */
const rowCache = new WeakMap<PMNode, readonly MarqueeRow[]>();

export function marqueeRows(doc: PMNode, registry: BlockRegistry): readonly MarqueeRow[] {
  const cached = rowCache.get(doc);
  if (cached) return cached;

  const entries = walkBlocks(doc, registry);
  const selectable = entries.filter(
    (entry) => entry.sid !== '' && !containerBlockNames.has(entry.node.type.name),
  );
  const sidsWithinRange = (from: number, to: number): string[] =>
    selectable.filter((entry) => entry.pos >= from && entry.pos < to).map((entry) => entry.sid);

  const rows: MarqueeRow[] = [];
  let offset = 0;
  doc.forEach((child) => {
    const pos = offset;
    offset += child.nodeSize;

    let cellChildren: MarqueeCellChild[] | null = null;
    if (child.type.name === 'twoColumn') {
      const cells: MarqueeCellChild[] = [];
      const collect = (row: PMNode, rowPos: number) => {
        let inRow = rowPos + 1;
        row.forEach((cell) => {
          const cellPos = inRow;
          inRow += cell.nodeSize;
          if (cell.type.name !== 'columnGroup') return; // the row's own line
          let inCell = cellPos + 1;
          cell.forEach((grand) => {
            const grandPos = inCell;
            inCell += grand.nodeSize;
            if (!registry.byNodeName.has(grand.type.name)) return; // the cell's line
            // A row nested inside a cell (paste/import data; the slash menu
            // refuses to nest) opens up the same way, so a band crossing only
            // one of its inner cells selects only that cell's blocks rather
            // than the whole nested row as one opaque rect.
            if (grand.type.name === 'twoColumn') collect(grand, grandPos);
            else cells.push({ pos: grandPos, sids: sidsWithinRange(grandPos, grandPos + grand.nodeSize) });
          });
        });
      };
      collect(child, pos);
      cellChildren = cells;
    }

    rows.push({ pos, sids: sidsWithinRange(pos, pos + child.nodeSize), cellChildren });
  });

  rowCache.set(doc, rows);
  return rows;
}
