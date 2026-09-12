/**
 * Where a block drag lands inside a two-column layout: the lane under the
 * pointer and the slot in it, or the signal that the page's own gaps decide.
 *
 * A lane is a column cell read as a small document of its own, so the slot
 * logic is the top-level reorder's (quarter bands, sticky middle, no-op
 * suppression) applied to the cell's blocks. What this adds is the choice of
 * lane. A layout's rectangle belongs to its lanes entirely: the way out of a
 * column is to leave that rectangle, where the gap resolver paints the line
 * beside the layout, so no strip along the edges is reserved for it and a
 * lane's first and last slots stay reachable however short the row is.
 *
 * Pure: it takes rows the caller has measured and returns numbers.
 */

import type { Point } from '@/lib/dnd/usePointerDrag';

import { resolveBlockReorder, type BlockRow, type ReorderTarget } from './resolve-block-reorder';

/** One column cell of a layout row, in viewport coordinates. */
export interface Lane {
  /** Position before the cell node. */
  cellPos: number;
  cellSid: string;
  /** Block children in the cell; the mandatory line is not one. */
  blockCount: number;
  left: number;
  width: number;
  /** The cell's realized blocks in order; `index` is the block-child index. */
  rows: readonly BlockRow[];
}

/** One two-column layout. A layout nested in a cell is a row at the next depth. */
export interface ColumnRow {
  /** Position before the two-column node. */
  pos: number;
  /** How many two-column ancestors the row has; 0 for a row on the page. */
  depth: number;
  top: number;
  bottom: number;
  left: number;
  width: number;
  lanes: readonly Lane[];
}

/** The dragged block: its range, and its cell and index there when it sits in a column. */
export interface DragSource {
  pos: number;
  end: number;
  cellPos: number | null;
  cellIndex: number | null;
}

export interface GapTarget extends ReorderTarget {
  kind: 'gap';
}

export interface CellTarget extends ReorderTarget {
  kind: 'cell';
  cellPos: number;
  cellSid: string;
}

export type BlockDropTarget = GapTarget | CellTarget;

/** The slot the indicator showed last: in which lane (null for the page) and at which gap. */
export interface PreviousSlot {
  cellPos: number | null;
  insertIndex: number;
}

export interface ResolveColumnDropInput {
  rows: readonly ColumnRow[];
  pointer: Point;
  source: DragSource;
  previous: PreviousSlot | null;
}

/**
 * A cell target, or `stay` for a pointer over a lane whose drop would leave the
 * block where it is. Null means the pointer is over no lane, so the page's gap
 * resolver decides.
 */
export type ColumnDrop = CellTarget | { kind: 'stay' };

/** The sticky insert index for one lane, or the page, from the last slot shown. */
export function stickyIndex(previous: PreviousSlot | null, cellPos: number | null): number | null {
  return previous && previous.cellPos === cellPos ? previous.insertIndex : null;
}

export function sameBlockDropTarget(a: BlockDropTarget | null, b: BlockDropTarget | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind !== b.kind || a.insertIndex !== b.insertIndex || a.line.top !== b.line.top) return false;
  return a.kind === 'cell' && b.kind === 'cell' ? a.cellPos === b.cellPos : true;
}

function containsPointer(row: ColumnRow, pointer: Point): boolean {
  return (
    pointer.y >= row.top &&
    pointer.y < row.bottom &&
    pointer.x >= row.left &&
    pointer.x < row.left + row.width
  );
}

/** A layout inside the dragged block leaves with it, so its lanes are never a landing. */
function insideSource(row: ColumnRow, source: DragSource): boolean {
  return row.pos >= source.pos && row.pos < source.end;
}

/** The lane under `x`, or the nearest one when `x` is on the splitter between them. */
function laneAt(row: ColumnRow, x: number): Lane | null {
  let nearest: Lane | null = null;
  let nearestDistance = Infinity;
  for (const lane of row.lanes) {
    const right = lane.left + lane.width;
    const distance = x < lane.left ? lane.left - x : x >= right ? x - right : 0;
    if (distance < nearestDistance) {
      nearest = lane;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function slotIn(lane: Lane, input: ResolveColumnDropInput): ColumnDrop {
  const { source, pointer, previous } = input;
  const target = resolveBlockReorder({
    rows: lane.rows,
    blockCount: lane.blockCount,
    sourceIndex: source.cellPos === lane.cellPos ? source.cellIndex : null,
    pointerY: pointer.y,
    left: lane.left,
    width: lane.width,
    previousInsertIndex: stickyIndex(previous, lane.cellPos),
  });
  if (!target) return { kind: 'stay' };
  return { kind: 'cell', cellPos: lane.cellPos, cellSid: lane.cellSid, ...target };
}

/** Resolve the drag against the layouts on screen; the innermost row under the pointer decides. */
export function resolveColumnDrop(input: ResolveColumnDropInput): ColumnDrop | null {
  const { pointer, source } = input;
  let innermost: ColumnRow | null = null;
  for (const row of input.rows) {
    if (!containsPointer(row, pointer) || insideSource(row, source)) continue;
    if (!innermost || row.depth > innermost.depth) innermost = row;
  }
  if (!innermost) return null;
  const lane = laneAt(innermost, pointer.x);
  return lane ? slotIn(lane, input) : null;
}
