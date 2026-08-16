/**
 * A deterministic first-fit box packer on a fixed cell grid.
 *
 * Two places in the fixture need packing and both need the same guarantee: heterogeneous
 * boxes laid out with NO overlap, in a stable order, identically on every engine. The
 * DENSE-GRID board is one (its whole reason to exist is uniform all-visible density, which a
 * pile of mutually overlapping boxes is not), and the interior of a frame is the other (a
 * frame that contains its members must not stack them on top of each other).
 *
 * A cell grid rather than a free-form skyline because it makes "these two boxes do not
 * overlap" a fact of integer arithmetic rather than a float comparison with a tolerance, and
 * the generator asserts non-overlap on the finished fixture.
 */

import type { Point2 } from './balanced-layout'

export interface PackItem {
  readonly id: string
  readonly width: number
  readonly height: number
}

export interface PackResult {
  /** Top-left of each item, relative to the packed region's own origin. */
  readonly positions: ReadonlyMap<string, Point2>
  /** Extent actually occupied. A half-empty last row must not inflate it. */
  readonly width: number
  readonly height: number
}

/** How many cells a box of `size` occupies along an axis with cells of `cell`. */
export function spanOf(size: number, cell: number): number {
  return Math.max(1, Math.ceil(size / cell))
}

function totalCells(items: readonly PackItem[], cellWidth: number, cellHeight: number): number {
  let sum = 0
  for (const item of items) sum += spanOf(item.width, cellWidth) * spanOf(item.height, cellHeight)
  return sum
}

function widestSpan(items: readonly PackItem[], cellWidth: number): number {
  let widest = 1
  for (const item of items) widest = Math.max(widest, spanOf(item.width, cellWidth))
  return widest
}

/**
 * The column count whose packed result lands closest to `aspect` (width over height). Used for
 * the board, where a region shaped like the viewport is what makes the whole document fit at
 * the highest possible zoom, and a wrong aspect ratio is what pushes it under the camera floor.
 */
export function columnsForAspect(
  items: readonly PackItem[],
  cellWidth: number,
  cellHeight: number,
  aspect: number,
): number {
  const cells = totalCells(items, cellWidth, cellHeight)
  const raw = Math.ceil(Math.sqrt((cells * cellHeight * aspect) / cellWidth))
  return Math.max(widestSpan(items, cellWidth), raw, 1)
}

/**
 * The column count that keeps the packed result within `maxRows` rows, so a frame drawn around
 * a tall tree subtree stays as tall as the subtree and grows sideways instead. Growing sideways
 * is safe in a tidy-tree layout (the band beyond a subtree's deepest rank is empty); growing
 * downward is not, because the next subtree's slot starts one node-spacing below.
 */
export function columnsForMaxRows(
  items: readonly PackItem[],
  cellWidth: number,
  cellHeight: number,
  maxRows: number,
): number {
  const cells = totalCells(items, cellWidth, cellHeight)
  const rows = Math.max(1, maxRows)
  return Math.max(widestSpan(items, cellWidth), Math.ceil(cells / rows), 1)
}

export interface PackOptions {
  readonly cellWidth: number
  readonly cellHeight: number
  readonly columns: number
}

/**
 * Places every item in the first free cell run, scanning rows top to bottom and columns left
 * to right. Items wider than `columns` would never fit, so the column count is raised to hold
 * the widest one rather than silently dropping it.
 */
export function packCells(items: readonly PackItem[], options: PackOptions): PackResult {
  const { cellWidth, cellHeight } = options
  const columns = Math.max(options.columns, widestSpan(items, cellWidth))

  const occupied: boolean[][] = []
  const freeInRow: number[] = []
  const ensureRows = (count: number): void => {
    while (occupied.length < count) {
      occupied.push(new Array<boolean>(columns).fill(false))
      freeInRow.push(columns)
    }
  }

  const fits = (row: number, col: number, spanR: number, spanC: number): boolean => {
    for (let r = row; r < row + spanR; r += 1) {
      const cells = occupied[r]
      for (let c = col; c < col + spanC; c += 1) {
        if (cells[c]) return false
      }
    }
    return true
  }

  const positions = new Map<string, Point2>()
  let usedColumns = 0
  let usedRows = 0
  let scanFrom = 0

  for (const item of items) {
    const spanC = spanOf(item.width, cellWidth)
    const spanR = spanOf(item.height, cellHeight)

    let placedRow = -1
    let placedCol = -1
    for (let row = scanFrom; placedRow < 0; row += 1) {
      ensureRows(row + spanR)
      if (freeInRow[row] < spanC) continue
      for (let col = 0; col + spanC <= columns; col += 1) {
        if (!fits(row, col, spanR, spanC)) continue
        placedRow = row
        placedCol = col
        break
      }
    }

    for (let r = placedRow; r < placedRow + spanR; r += 1) {
      for (let c = placedCol; c < placedCol + spanC; c += 1) {
        occupied[r][c] = true
      }
      freeInRow[r] -= spanC
    }
    positions.set(item.id, { x: placedCol * cellWidth, y: placedRow * cellHeight })
    usedColumns = Math.max(usedColumns, placedCol + spanC)
    usedRows = Math.max(usedRows, placedRow + spanR)
    while (scanFrom < freeInRow.length && freeInRow[scanFrom] === 0) scanFrom += 1
  }

  return { positions, width: usedColumns * cellWidth, height: usedRows * cellHeight }
}

export interface ShelfBox {
  readonly id: string
  readonly width: number
  readonly height: number
}

/**
 * Row-by-row shelf placement with a fixed gap, for the small set of boxes that are placed as
 * whole units rather than on a cell grid (the FOREST band of frames that sit away from the
 * tree). Kept separate from `packCells` because these boxes differ in size by two orders of
 * magnitude, where a cell grid would waste more than it saves.
 */
export function shelfPack(boxes: readonly ShelfBox[], maxRowWidth: number, gap: number): PackResult {
  const positions = new Map<string, Point2>()
  let cursorX = 0
  let cursorY = 0
  let rowHeight = 0
  let usedWidth = 0

  for (const box of boxes) {
    if (cursorX > 0 && cursorX + box.width > maxRowWidth) {
      cursorX = 0
      cursorY += rowHeight + gap
      rowHeight = 0
    }
    positions.set(box.id, { x: cursorX, y: cursorY })
    cursorX += box.width + gap
    usedWidth = Math.max(usedWidth, cursorX - gap)
    rowHeight = Math.max(rowHeight, box.height)
  }

  return { positions, width: usedWidth, height: cursorY + rowHeight }
}
