/**
 * Where a vertical block drag would land: a pure map from the pointer's Y and the
 * measured block rows to an insertion gap, plus the drop line to paint for it.
 *
 * Same-container, top-level reorder only. Column insertion, edge split and the
 * cross-container ladder are out of scope here, with their own model; nothing here
 * knows about columns.
 *
 * The geometry matches the desktop editor's `GetInsertIndex`: each row is three
 * bands - a top quarter that inserts before it, a bottom quarter that inserts
 * after it, and a middle half that is sticky, keeping whichever edge was already
 * chosen so a tall block does not flicker its indicator as the pointer crosses
 * the centre. The snap band is a quarter of the row height with a 4px floor for
 * short rows.
 *
 * Purity is the point: it takes rows already measured by the caller (which is
 * where `content-visibility` realization is forced) and returns numbers, so the
 * band logic, the hysteresis and the no-op suppression are all testable without a
 * live view or a browser.
 */

/** The share of a row, at top and bottom, that inserts rather than sitting sticky. */
export const INSERT_BAND = 0.25;

/** The snap band never shrinks below this, so a one-line row still has three bands. */
export const MIN_SNAP_BAND = 4;

/** The painted drop line's thickness. */
export const DROP_LINE_HEIGHT = 2;

export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** One measured top-level block, in viewport coordinates. `index` is its document-child index. */
export interface BlockRow {
  index: number;
  top: number;
  bottom: number;
}

export interface ReorderTarget {
  /** The gap the block would move into, in `[0, blockCount]`. */
  insertIndex: number;
  /**
   * The child index the move lands on once the dragged block is removed. A move
   * to a gap after the block's old slot shifts down by one when the block leaves.
   */
  moveTo: number;
  /** The line to paint at the chosen boundary. */
  line: Box;
}

export interface ResolveReorderInput {
  /** Realized rows in document order (ascending `index`). Off-screen rows are omitted. */
  rows: readonly BlockRow[];
  /** Total top-level blocks, so "past the last row" can mean the true end. */
  blockCount: number;
  /** The dragged block's document-child index. */
  sourceIndex: number;
  pointerY: number;
  /** The drop line's horizontal extent, the note column. */
  left: number;
  width: number;
  /** The insert index the indicator currently shows, for the sticky middle band. */
  previousInsertIndex: number | null;
}

/**
 * The gap index the pointer picks, before no-op suppression. Ascending-`index`
 * rows are assumed. A pointer above the first row inserts before it; below the
 * last realized row it inserts at the document's true end, which is also how a
 * drag past an off-screen tail region reads.
 */
function insertIndexAt(input: ResolveReorderInput): number {
  const { rows, blockCount, pointerY, previousInsertIndex } = input;
  if (rows.length === 0) return blockCount;

  const first = rows[0];
  const last = rows[rows.length - 1];
  if (pointerY < first.top) return first.index;
  if (pointerY >= last.bottom) return blockCount;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const next = rows[i + 1];
    // Close the margin gap to the next row. Measured rects are border boxes, so
    // two stacked blocks leave an 8px+ gap between them; without this a pointer
    // resting in that gap matches no row and falls through to the document end.
    const rangeBottom = next ? next.top : row.bottom;
    if (pointerY < row.top || pointerY >= rangeBottom) continue;

    const height = row.bottom - row.top;
    const band = Math.max(MIN_SNAP_BAND, height * INSERT_BAND);
    const before = row.index;
    const after = row.index + 1;

    // At or below the row's own bottom (i.e. in the gap under it) counts as after.
    if (pointerY >= row.bottom - band) return after;
    if (pointerY < row.top + band) return before;

    // Middle half: keep whichever edge is already chosen so the line does not
    // flip as the pointer drifts across a tall block. Only the first entry with
    // no prior edge falls back to the midpoint.
    if (previousInsertIndex === before || previousInsertIndex === after) return previousInsertIndex;
    return pointerY < (row.top + row.bottom) / 2 ? before : after;
  }

  return blockCount;
}

/** The Y the drop line sits at for a gap, from whichever bounding row is realized. */
function lineYFor(input: ResolveReorderInput, insertIndex: number): number | null {
  const { rows } = input;
  if (rows.length === 0) return null;

  const at = rows.find((row) => row.index === insertIndex);
  if (at) return at.top;
  const before = rows.find((row) => row.index === insertIndex - 1);
  if (before) return before.bottom;

  // The boundary block is off screen. Clamp the line to the realized rows so a
  // drop heading past an unmeasured region still shows where it is going, the way
  // an append past a virtualized tail lands on the last visible block's bottom.
  const first = rows[0];
  const last = rows[rows.length - 1];
  if (insertIndex <= first.index) return first.top;
  if (insertIndex > last.index) return last.bottom;
  return null;
}

/**
 * Resolve the drag, or null when the drop would not move the block: onto its own
 * slot (`insertIndex === sourceIndex`) or into the gap right after it
 * (`insertIndex === sourceIndex + 1`). Returning null there means no line is
 * painted and the release commits nothing, so the indicator never promises a move
 * that will not happen.
 */
export function resolveBlockReorder(input: ResolveReorderInput): ReorderTarget | null {
  if (input.blockCount <= 1) return null;

  const insertIndex = insertIndexAt(input);
  if (insertIndex === input.sourceIndex || insertIndex === input.sourceIndex + 1) return null;

  const lineY = lineYFor(input, insertIndex);
  if (lineY === null) return null;

  const moveTo = input.sourceIndex < insertIndex ? insertIndex - 1 : insertIndex;
  return {
    insertIndex,
    moveTo,
    line: {
      top: lineY - DROP_LINE_HEIGHT / 2,
      left: input.left,
      width: input.width,
      height: DROP_LINE_HEIGHT,
    },
  };
}
