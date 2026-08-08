/**
 * Placement math for the overview board, ported 1:1 from
 * Mnemo.Infrastructure/Services/Widgets/WidgetLayoutEngine.cs.
 *
 * `pack` is a dense flow packer (CSS `grid-auto-flow: dense` semantics) used to seed coordinates
 * and to compact narrow breakpoints. `resolve` honours each widget's stored coordinates and pushes
 * overlaps down only, which is what makes the board a free grid rather than a flow.
 *
 * Pure and UI-free on purpose: WidgetLayoutEngineTests is the only executable statement of this
 * contract, and engine.test.ts transcribes it case for case.
 */

import { clamp } from "./clamp"

/**
 * A widget's size as a column x row span in grid units, not pixels. Mirrors the C# WidgetSize
 * record. The active column count clamps `columns` at layout time.
 *
 * Declared here rather than imported from `@/api/types`: the Overview wire contract does not exist
 * yet, and inventing a DTO shape ahead of the Host would be guessing. When `WidgetSizeDto` lands it
 * is structurally this type, and this alias should be replaced by the import.
 */
export interface WidgetSize {
  columns: number
  rows: number
}

/**
 * Computed board position of one widget: the cell the engine assigned plus the (possibly clamped)
 * span it occupies. Transient output, never persisted.
 */
export interface WidgetPlacement {
  column: number
  row: number
  columnSpan: number
  rowSpan: number
}

/**
 * A widget's requested position and span, the input to `resolve`. `column`/`row` are the canonical
 * 4-column grid coordinates the user placed it at; -1 on either axis means unassigned, so the
 * engine drops it into the first free cell instead.
 */
export interface DesiredPlacement {
  column: number
  row: number
  size: WidgetSize
}

/** A cell reference the fit search returns. */
interface Cell {
  column: number
  row: number
}

// The C# engine also guards its list argument with ArgumentNullException.ThrowIfNull. There is no
// port equivalent: the parameter types are non-nullable under strict TypeScript.
const INVALID_COLUMN_COUNT = "Column count must be at least 1."

/**
 * Dense flow-pack of an ordered list of sizes. One placement per input size, in input order, so a
 * later narrow widget can backfill a hole an earlier wide one left above it.
 */
export function pack(sizes: readonly WidgetSize[], columnCount: number): WidgetPlacement[] {
  if (columnCount < 1) throw new RangeError(INVALID_COLUMN_COUNT)

  const occupied: boolean[][] = []
  const placements: WidgetPlacement[] = []

  for (const size of sizes) {
    // Columns are clamped on both sides, rows only floored: the grid is vertically unbounded, so
    // capping a row span would be wrong.
    const columns = clamp(size.columns, 1, columnCount)
    const rows = Math.max(1, size.rows)

    const { column, row } = findFirstFit(occupied, columns, rows, columnCount)
    occupy(occupied, column, row, columns, rows, columnCount)
    placements.push({ column, row, columnSpan: columns, rowSpan: rows })
  }

  return placements
}

/**
 * Free-grid placement: every widget keeps its stored cell unless something already sits there, in
 * which case it slides straight down until it fits. Returns placements aligned to the input
 * indices, whatever order they were processed in.
 */
export function resolve(
  desired: readonly DesiredPlacement[],
  columnCount: number,
  anchorIndex = -1,
): WidgetPlacement[] {
  if (columnCount < 1) throw new RangeError(INVALID_COLUMN_COUNT)

  // resolveOrder visits every index exactly once, so every slot is written before the return.
  const placements = new Array<WidgetPlacement>(desired.length)
  const occupied: boolean[][] = []

  for (const i of resolveOrder(desired, anchorIndex)) {
    const d = desired[i]
    const columns = clamp(d.size.columns, 1, columnCount)
    const rows = Math.max(1, d.size.rows)

    let column: number
    let row: number
    if (d.column < 0 || d.row < 0) {
      // Unassigned (freshly added, or pre-coordinates): drop into the first free cell.
      ;({ column, row } = findFirstFit(occupied, columns, rows, columnCount))
    } else {
      // The span is clamped first, because the rightmost legal column depends on how wide the
      // widget ended up being.
      column = clamp(d.column, 0, columnCount - columns)
      // Push straight down until the desired column fits, never sideways and never up, so an
      // intentional gap above the widget survives.
      row = Math.max(0, d.row)
      while (!fits(occupied, column, row, columns, rows)) row++
    }

    occupy(occupied, column, row, columns, rows, columnCount)
    placements[i] = { column, row, columnSpan: columns, rowSpan: rows }
  }

  return placements
}

/**
 * Processing order for `resolve`: the anchor (dragged tile) first so it keeps the cell the pointer
 * chose, then assigned widgets top-to-bottom and left-to-right, then any unassigned ones so they
 * backfill the remaining holes. Original index breaks ties, which is what makes it deterministic.
 *
 * The anchor bypasses the comparator entirely rather than sorting to the front, so it wins even
 * against widgets with a smaller row or column.
 */
export function resolveOrder(desired: readonly DesiredPlacement[], anchorIndex: number): number[] {
  // Unassigned axes sort last. Infinity is safe as a sort key here because equal keys are caught by
  // the `!==` check before any subtraction could produce NaN.
  const rowKey = (i: number): number => (desired[i].row < 0 ? Infinity : desired[i].row)
  const columnKey = (i: number): number => (desired[i].column < 0 ? Infinity : desired[i].column)

  const rest = desired
    .map((_, i) => i)
    .filter((i) => i !== anchorIndex)
    .sort((a, b) => {
      const ra = rowKey(a)
      const rb = rowKey(b)
      if (ra !== rb) return ra - rb
      const ca = columnKey(a)
      const cb = columnKey(b)
      if (ca !== cb) return ca - cb
      return a - b
    })

  return anchorIndex >= 0 && anchorIndex < desired.length ? [anchorIndex, ...rest] : rest
}

/**
 * Row-major scan for the topmost, then leftmost, cell the span fits in. Scanning exactly one row
 * past the current extent guarantees a fit is always found.
 */
function findFirstFit(
  occupied: readonly boolean[][],
  columns: number,
  rows: number,
  columnCount: number,
): Cell {
  for (let row = 0; row <= occupied.length; row++) {
    for (let column = 0; column <= columnCount - columns; column++) {
      if (fits(occupied, column, row, columns, rows)) return { column, row }
    }
  }

  return { column: 0, row: occupied.length }
}

/** Whether a `columns` x `rows` span starting at (column, row) lands entirely on free cells. */
function fits(
  occupied: readonly boolean[][],
  column: number,
  row: number,
  columns: number,
  rows: number,
): boolean {
  for (let r = row; r < row + rows; r++) {
    // Rows below the current extent are empty by definition, and r only grows, so nothing below
    // this one can be occupied either. The push-down loop in `resolve` depends on being able to
    // probe rows that do not exist yet.
    if (r >= occupied.length) return true

    for (let c = column; c < column + columns; c++) {
      if (occupied[r][c]) return false
    }
  }

  return true
}

/** Marks a span as taken, growing the grid downward one `columnCount`-wide row at a time. */
function occupy(
  occupied: boolean[][],
  column: number,
  row: number,
  columns: number,
  rows: number,
  columnCount: number,
): void {
  while (occupied.length < row + rows) occupied.push(new Array<boolean>(columnCount).fill(false))

  for (let r = row; r < row + rows; r++) {
    for (let c = column; c < column + columns; c++) occupied[r][c] = true
  }
}
