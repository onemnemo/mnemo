import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import type { Node as PMNode } from 'prosemirror-model'

import { AppIcon } from '@/components/icon/AppIcon'
import { Menu, MenuContent, MenuTrigger } from '@/components/ui/menu'
import { cn } from '@/lib/utils'
import { useT } from '@/i18n/useT'

import {
  TABLE_COL_W,
  clearRect,
  colRect,
  columnCount,
  insertCols,
  insertRows,
  isSingleCell,
  landedAt,
  moveCol,
  moveRow,
  movesAnything,
  normalizeRect,
  rectHolds,
  rowCells,
  rowRect,
  setColumnWidth,
  tableRows,
  trimCols,
  trimRows,
  type Rect,
} from './model'
import { AxisMenuItems, CellMenuItems } from './TableMenus'
import { useTableGrid } from './useTableGrid'

/**
 * Everything on a table that is not the text in it.
 *
 * A table is the only block with a second axis, and nearly every decision here
 * follows from that: the block gutter can say *this block*, but only the table
 * can say *this column*. So the table grows its own gutters, a strip above every
 * column and another beside every row, carrying the same three verbs the block
 * gutter carries, one rank down: hold it, act on it, add another.
 *
 * ## Chrome is either being reached for or it is not there
 *
 * The first version showed every grip and both rails the moment the pointer
 * touched the block: nine handles for a five-row table, all of them about
 * something you were not doing. What a table needs is the opposite, the controls
 * for the row you are in, the column you are in, and the edge you are near. So
 * hover is tracked once, in bands rather than pixels, and each piece of chrome
 * asks whether it is the one being reached for.
 *
 * There is also one handle per axis rather than one per column, and it travels.
 * Five handles fading in and out as the pointer crossed cell borders was motion
 * everywhere, none of it about anything; one that slides to the column you are in
 * is the same information with a single thing moving.
 *
 * ## Adding is one gesture
 *
 * Click the rail for one row, drag it for as many as you drag past, applied to
 * the table itself rather than to a preview of it. A click is the n = 1 case of
 * the drag, so there is nothing extra to learn and no second control, and
 * dragging back up takes the empty ones away again.
 */

/** Travel before a press on a handle becomes a drag rather than a click. */
const DRAG_PX = 4
/** The handle's short side. Its long side is the row or column it belongs to. */
const HANDLE = 12
/** Gap between the table's edge and the handle outside it. */
const GAP = 5
/** Most rows one drag of a rail can add. Columns are capped by the pane. */
const MAX_ADD = 20
/**
 * How far outside the table the edges still answer. The rails sit in this band,
 * so it has to cover them: a control that disappears while you are travelling
 * towards it is worse than one that was never there.
 */
const REACH = 28
/**
 * Chrome timing. Leaving is slower than arriving on purpose: a control you are
 * travelling towards should be there already, and one you have just left should
 * not vanish out from under a change of mind. Both at 100ms read as flicker
 * rather than as motion.
 */
const IN_MS = 140
const OUT_MS = 220

type Sel =
  | { kind: 'cells'; rect: Rect }
  | { kind: 'row'; at: number }
  | { kind: 'col'; at: number }

export interface TableChromeProps {
  node: PMNode
  /** The positioned element every overlay is measured and drawn against. */
  frame: HTMLElement
  editable: boolean
  replaceTable: (
    next: PMNode,
    options?: { caret?: { row: number; col: number }; addToHistory?: boolean },
  ) => void
  focusCell: (row: number, col: number) => void
  /** The cell the caret is in, read from the document rather than from the DOM. */
  caretCell: () => { row: number; col: number } | null
}

/** Which band a coordinate lands in, or -1 outside the run. */
function bandAt(edges: readonly number[], value: number): number {
  if (value < 0 || value >= edges[edges.length - 1]) return -1
  for (let i = 0; i < edges.length - 1; i++) if (value < edges[i + 1]) return i
  return -1
}

const selRect = (sel: Sel, node: PMNode): Rect =>
  sel.kind === 'row' ? rowRect(node, sel.at) : sel.kind === 'col' ? colRect(node, sel.at) : normalizeRect(sel.rect)

export function TableChrome({
  node,
  frame,
  editable,
  replaceTable,
  focusCell,
  caretCell,
}: TableChromeProps) {
  const t = useT()
  const rows = tableRows(node).length
  const cols = columnCount(node)

  const [sel, setSel] = useState<Sel | null>(null)
  const [near, setNear] = useState<{ row: number; col: number; right: boolean; bottom: boolean } | null>(null)
  /** A reorder in flight; `to` is the gap the run would land in. */
  const [move, setMove] = useState<{ kind: 'row' | 'col'; from: number; to: number } | null>(null)
  /** Which rail is being dragged, so it stays up while the pointer runs away. */
  const [growing, setGrowing] = useState<'row' | 'col' | null>(null)
  const [resizing, setResizing] = useState<number | null>(null)
  /** Where a right-click landed, in frame coordinates, so the menu opens there. */
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)

  /** True while a grip drag runs, so the click it ends with cannot also open the menu. */
  const dragged = useRef(false)
  /** Where each handle stands when there is nothing to point at. */
  const restCol = useRef(0)
  const restRow = useRef(0)
  /** The live node, for handlers bound once and read from during a drag. */
  const latest = useRef(node)
  latest.current = node

  const grid = useTableGrid(frame, [rows, cols, node.attrs.columnWidths, node.attrs.fullWidth])
  const ready = grid.x.length === cols + 1 && grid.y.length === rows + 1
  const width = grid.x[grid.x.length - 1]
  const height = grid.y[grid.y.length - 1]
  const rect = sel ? selRect(sel, node) : null

  const apply = useCallback((next: PMNode) => replaceTable(next), [replaceTable])
  const clearSelection = useCallback(() => setSel(null), [])

  /* -- hover ------------------------------------------------------------- */

  useEffect(() => {
    if (!editable) return
    const onMove = (event: PointerEvent): void => {
      if (growing) return
      const box = frame.getBoundingClientRect()
      const x = event.clientX - box.left
      const y = event.clientY - box.top
      // The margin either side counts as inside: the handles live out there.
      const inX = x > -(HANDLE + GAP + 4) && x < width + REACH
      const inY = y > -(HANDLE + GAP + 4) && y < height + REACH
      const next = {
        row: inX ? bandAt(grid.y, y) : -1,
        col: inY ? bandAt(grid.x, x) : -1,
        // The last column and everything to its right, so the rail is already
        // there by the time you reach the edge.
        right: inY && x >= grid.x[grid.x.length - 2] && x < width + REACH,
        bottom: inX && y >= grid.y[grid.y.length - 2] && y < height + REACH,
      }
      setNear((prev) =>
        prev &&
        prev.row === next.row &&
        prev.col === next.col &&
        prev.right === next.right &&
        prev.bottom === next.bottom
          ? prev
          : next,
      )
    }
    const onLeave = (): void => {
      if (!growing) setNear(null)
    }
    frame.addEventListener('pointermove', onMove)
    frame.addEventListener('pointerleave', onLeave)
    return () => {
      frame.removeEventListener('pointermove', onMove)
      frame.removeEventListener('pointerleave', onLeave)
    }
  }, [frame, editable, growing, grid, width, height])

  /* -- cells: a range is a drag, not a modifier -------------------------- */

  useEffect(() => {
    const cellAt = (target: EventTarget | null): { row: number; col: number } | null => {
      const cell = target instanceof Element ? target.closest<HTMLElement>('[data-table-cell]') : null
      if (!cell) return null
      const row = cell.parentElement?.closest<HTMLElement>('[data-table-row]')
      if (!row) return null
      const rowIndex = Array.from(frame.querySelectorAll('[data-table-row]')).indexOf(row)
      const colIndex = Array.from(row.querySelectorAll('[data-table-cell]')).indexOf(cell)
      if (rowIndex < 0 || colIndex < 0) return null
      return { row: rowIndex, col: colIndex }
    }

    const onDown = (event: PointerEvent): void => {
      const start = cellAt(event.target)
      if (!start) return
      if (event.button === 2) {
        // Right-click keeps a range you already have. Otherwise the menu is about
        // one cell while the paint underneath it says four.
        setSel((prev) => {
          const held = prev ? selRect(prev, latest.current) : null
          return rectHolds(held, start.row, start.col)
            ? prev
            : { kind: 'cells', rect: { r0: start.row, c0: start.col, r1: start.row, c1: start.col } }
        })
        return
      }
      if (event.button !== 0) return

      setSel({ kind: 'cells', rect: { r0: start.row, c0: start.col, r1: start.row, c1: start.col } })

      let crossed = false
      const onPointerMove = (moveEvent: PointerEvent): void => {
        const over = cellAt(document.elementFromPoint(moveEvent.clientX, moveEvent.clientY))
        if (!over) return
        if (!crossed) {
          if (over.row === start.row && over.col === start.col) return
          crossed = true
          // Two answers to one gesture, a ragged text range inside one cell and a
          // clean rectangle across four, is the thing to avoid. The moment the
          // drag leaves its own cell, the caret loses.
          ;(document.activeElement as HTMLElement | null)?.blur()
          window.getSelection()?.removeAllRanges()
        }
        setSel({ kind: 'cells', rect: { r0: start.row, c0: start.col, r1: over.row, c1: over.col } })
      }
      const onUp = (): void => {
        window.removeEventListener('pointermove', onPointerMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onPointerMove)
      window.addEventListener('pointerup', onUp)
    }

    const onContextMenu = (event: MouseEvent): void => {
      if (!editable || !cellAt(event.target)) return
      event.preventDefault()
      // Stopped here so the editor's own menu does not also open: two menus for
      // one press, one of them about the wrong thing.
      event.stopPropagation()
      const box = frame.getBoundingClientRect()
      setMenuAt({ x: event.clientX - box.left, y: event.clientY - box.top })
    }

    frame.addEventListener('pointerdown', onDown)
    frame.addEventListener('contextmenu', onContextMenu)
    return () => {
      frame.removeEventListener('pointerdown', onDown)
      frame.removeEventListener('contextmenu', onContextMenu)
    }
  }, [frame, editable])

  /* -- keyboard ---------------------------------------------------------- */

  useEffect(() => {
    if (!editable) return

    /** Whether the caret sits at the very start or end of the text it is in. */
    const atEdge = (end: boolean): boolean => {
      const selection = window.getSelection()
      const node = selection?.anchorNode
      if (!selection || !node) return true
      const offset = selection.anchorOffset
      return end ? offset === (node.textContent?.length ?? 0) : offset === 0
    }

    const goTo = (row: number, col: number): void => {
      focusCell(row, col)
      setSel({ kind: 'cells', rect: { r0: row, c0: col, r1: row, c1: col } })
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      const table = latest.current
      const rowCount = tableRows(table).length
      const colCount = columnCount(table)
      const here = caretCell()

      if (event.key === 'Escape') {
        // Escape steps out one level at a time: text, then cells, then the block,
        // which is the editor's Escape and not ours.
        if (!sel) return
        event.stopPropagation()
        setSel(null)
        return
      }

      // A range of cells is a selection the caret is not in, so the key that
      // would delete a character empties the range instead. A single cell is left
      // to ProseMirror: there the caret is the selection.
      if (event.key === 'Delete' || event.key === 'Backspace') {
        const range = sel ? selRect(sel, table) : null
        if (!range || (sel?.kind === 'cells' && isSingleCell(range))) return
        event.preventDefault()
        event.stopPropagation()
        apply(clearRect(table, range))
        return
      }

      if (event.key === 'Tab' && here) {
        event.preventDefault()
        event.stopPropagation()
        let row = here.row
        let col = here.col + (event.shiftKey ? -1 : 1)
        if (col < 0) {
          col = colCount - 1
          row -= 1
        }
        if (col >= colCount) {
          col = 0
          row += 1
        }
        if (row < 0) return
        if (row >= rowCount) {
          // Tab off the last cell grows the table, which is how a table gets
          // typed rather than built.
          replaceTable(insertRows(table, rowCount, 1), { caret: { row, col: 0 } })
          setSel({ kind: 'cells', rect: { r0: row, c0: 0, r1: row, c1: 0 } })
          return
        }
        goTo(row, col)
        return
      }

      if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && here) {
        // Only from the ends of the text, so a wrapped cell walks its own lines
        // before it hands the key to the grid.
        const up = event.key === 'ArrowUp'
        if (!atEdge(!up)) return
        const row = here.row + (up ? -1 : 1)
        if (row < 0 || row >= rowCount) return
        event.preventDefault()
        event.stopPropagation()
        goTo(row, here.col)
      }
    }
    frame.addEventListener('keydown', onKeyDown)
    return () => frame.removeEventListener('keydown', onKeyDown)
  }, [frame, editable, sel, apply, replaceTable, focusCell, caretCell])

  /* -- the handle: one control, three outcomes --------------------------- */

  /**
   * Press selects, click opens, drag reorders.
   *
   * The version before this had you click a bar to turn it into a handle and then
   * click the handle to get the menu: two presses on the same three millimetres of
   * screen, the first of which did nothing you could use. There is only one column
   * it could be talking about by the time you have reached for it, so the press
   * does the selecting and the click that completes it does the opening.
   */
  const onHandleDown = (event: ReactPointerEvent, kind: 'row' | 'col', at: number): void => {
    if (event.button !== 0) return
    setSel(kind === 'row' ? { kind: 'row', at } : { kind: 'col', at })
    ;(document.activeElement as HTMLElement | null)?.blur()

    const start = kind === 'col' ? event.clientX : event.clientY
    const box = frame.getBoundingClientRect()
    const edges = kind === 'col' ? grid.x : grid.y
    let to = -1
    dragged.current = false

    const onPointerMove = (moveEvent: PointerEvent): void => {
      const now = kind === 'col' ? moveEvent.clientX : moveEvent.clientY
      if (!dragged.current && Math.abs(now - start) < DRAG_PX) return
      dragged.current = true
      const local = now - (kind === 'col' ? box.left : box.top)
      // The nearest boundary, not the nearest column: what a drop indicator points
      // at is the gap between two things.
      to = edges.reduce(
        (best, edge, index) => (Math.abs(edge - local) < Math.abs(edges[best] - local) ? index : best),
        0,
      )
      setMove({ kind, from: at, to })
    }

    const onUp = (): void => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onUp)
      setMove(null)
      if (to >= 0 && movesAnything(at, to)) {
        const table = latest.current
        apply(kind === 'row' ? moveRow(table, at, to) : moveCol(table, at, to))
        const landed = landedAt(at, to)
        setSel(kind === 'row' ? { kind: 'row', at: landed } : { kind: 'col', at: landed })
      }
      // The flag is cleared by whoever reads it, the click this drag ends in or
      // failing that the next press. Clearing it on a timer is a bet that frames
      // are still being painted, and a backgrounded tab is not painting any.
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onUp)
  }

  /* -- rails: one gesture, and a click is n = 1 -------------------------- */

  const onRailDown = (event: ReactPointerEvent, kind: 'row' | 'col'): void => {
    if (event.button !== 0) return
    event.preventDefault()

    const table = latest.current
    const start = kind === 'row' ? event.clientY : event.clientX
    // One step per thing added, at the size of the thing.
    const rowHeight = Math.max(28, height - (grid.y[grid.y.length - 2] ?? 0))
    const step = kind === 'row' ? rowHeight : TABLE_COL_W
    const at = kind === 'row' ? tableRows(table).length : columnCount(table)

    // Columns stop at the edge of the pane. A table dragged past it is a table you
    // cannot read, scrolled away from the rail that made it, and the drag that got
    // you there felt like nothing was happening. Rows have no such problem: the
    // page is already the thing that scrolls.
    const pane = frame.parentElement
    const room = pane ? Math.floor((pane.clientWidth - width - REACH) / TABLE_COL_W) : 1
    const cap = kind === 'row' ? MAX_ADD : Math.max(1, Math.min(MAX_ADD, room))

    /**
     * How far back the drag may go: past its own starting point, into rows that
     * were already there, but only while they are empty. The rail is the size
     * handle for the table, and a size handle that can only grow is half a
     * control; what it must never do is take words away, so the trailing blank run
     * is exactly how far it reaches and the first row with anything in it stops it
     * dead.
     */
    const spare = (() => {
      let count = 0
      const body = tableRows(table)
      if (kind === 'row') {
        for (let i = body.length - 1; i >= 1; i--) {
          if (rowCells(body[i]).some((cell) => cell.textContent.trim().length > 0)) break
          count++
        }
      } else {
        for (let i = columnCount(table) - 1; i >= 1; i--) {
          if (body.some((row) => (rowCells(row)[i]?.textContent ?? '').trim().length > 0)) break
          count++
        }
      }
      return count
    })()

    let count = 0
    const shapeFor = (n: number): PMNode => {
      if (n === 0) return table
      if (n > 0) {
        return kind === 'row'
          ? insertRows(table, tableRows(table).length, n)
          : insertCols(table, columnCount(table), n)
      }
      return kind === 'row' ? trimRows(table, -n) : trimCols(table, -n)
    }
    const preview = (next: number): void => {
      if (next === count) return
      count = next
      replaceTable(shapeFor(count), { addToHistory: false })
    }

    setGrowing(kind)
    preview(1)

    const onPointerMove = (moveEvent: PointerEvent): void => {
      const delta = (kind === 'row' ? moveEvent.clientY : moveEvent.clientX) - start
      preview(Math.max(-spare, Math.min(cap, 1 + Math.floor(delta / step))))
    }

    const onUp = (): void => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onUp)
      setGrowing(null)
      const final = shapeFor(count)
      // Put the pre-drag table back invisibly, then commit once: the twenty shapes
      // the drag passed through are not twenty things to undo.
      replaceTable(table, { addToHistory: false })
      if (count === 0) return
      // Land the caret in what was just made. A row you then have to click into is
      // half a feature.
      replaceTable(final, kind === 'row' && count > 0 ? { caret: { row: at, col: 0 } } : undefined)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onUp)
  }

  /* -- resize ------------------------------------------------------------ */

  const onResizeDown = (event: ReactPointerEvent, at: number): void => {
    if (event.button !== 0) return
    event.preventDefault()
    const table = latest.current
    const startX = event.clientX
    const startWidth = grid.x[at + 1] - grid.x[at]
    setResizing(at)
    let last = startWidth

    const onPointerMove = (moveEvent: PointerEvent): void => {
      last = startWidth + (moveEvent.clientX - startX)
      replaceTable(setColumnWidth(table, at, last), { addToHistory: false })
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onUp)
      setResizing(null)
      replaceTable(table, { addToHistory: false })
      if (Math.abs(last - startWidth) < 1) return
      replaceTable(setColumnWidth(table, at, last))
    }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onUp)
  }

  /* -- paint ------------------------------------------------------------- */

  const band: CSSProperties | null =
    rect && ready
      ? {
          left: grid.x[rect.c0],
          width: grid.x[rect.c1 + 1] - grid.x[rect.c0],
          top: grid.y[rect.r0],
          height: grid.y[rect.r1 + 1] - grid.y[rect.r0],
        }
      : null

  // A caret already says where you are, so a single cell being typed in keeps the
  // ring and drops the wash. Anything larger keeps both: there is no caret to read
  // it from.
  const washed = Boolean(rect) && !(sel?.kind === 'cells' && rect !== null && isSingleCell(rect))

  const shown = (on: boolean): CSSProperties => ({
    opacity: on ? 1 : 0,
    pointerEvents: on ? 'auto' : 'none',
    transition: `opacity ${on ? IN_MS : OUT_MS}ms ease-out`,
  })

  /**
   * Hover beats selection while the pointer is inside: the handle says where you
   * are, and the band already says what is selected. Once the pointer leaves, the
   * handle fades out where it stands rather than snapping home.
   */
  const colAt =
    move?.kind === 'col' ? move.from : (near?.col ?? -1) >= 0 ? near!.col : sel?.kind === 'col' ? sel.at : -1
  const rowAt =
    move?.kind === 'row' ? move.from : (near?.row ?? -1) >= 0 ? near!.row : sel?.kind === 'row' ? sel.at : -1
  if (colAt >= 0) restCol.current = colAt
  if (rowAt >= 0) restRow.current = rowAt
  const colIdx = Math.min(restCol.current, Math.max(0, cols - 1))
  const rowIdx = Math.min(restRow.current, Math.max(0, rows - 1))

  if (!ready) return null

  return (
    <>
      <div className="notes-table-overlay">
        {band ? (
          <div
            className="notes-table-band"
            style={{ ...band, background: washed ? 'var(--sel-block)' : undefined }}
          />
        ) : null}
        {move && movesAnything(move.from, move.to) ? (
          <div
            className="notes-table-drop"
            style={
              move.kind === 'col'
                ? { left: grid.x[move.to] - 1, width: 2, top: -6, height: height + 12 }
                : { top: grid.y[move.to] - 1, height: 2, left: -6, width: width + 12 }
            }
          />
        ) : null}
      </div>

      {editable ? (
        <>
          <div
            className="notes-table-handle-slot"
            style={{
              left: grid.x[colIdx],
              width: grid.x[colIdx + 1] - grid.x[colIdx],
              top: -(HANDLE + GAP),
              height: HANDLE,
              ...shown(colAt >= 0),
              transition: `left ${IN_MS}ms ease-out, width ${IN_MS}ms ease-out, opacity ${
                colAt >= 0 ? IN_MS : OUT_MS
              }ms ease-out`,
            }}
          >
            <AxisHandle
              kind="col"
              at={colIdx}
              on={sel?.kind === 'col' && sel.at === colIdx}
              label={t('NotesEditor', 'TableColumnActions', { 0: colIdx + 1 })}
              dragged={dragged}
              onDown={onHandleDown}
            >
              <AxisMenuItems
                node={node}
                apply={apply}
                clearSelection={clearSelection}
                kind="col"
                at={colIdx}
              />
            </AxisHandle>
          </div>

          <div
            className="notes-table-handle-slot"
            style={{
              top: grid.y[rowIdx],
              height: grid.y[rowIdx + 1] - grid.y[rowIdx],
              left: -(HANDLE + GAP),
              width: HANDLE,
              ...shown(rowAt >= 0),
              transition: `top ${IN_MS}ms ease-out, height ${IN_MS}ms ease-out, opacity ${
                rowAt >= 0 ? IN_MS : OUT_MS
              }ms ease-out`,
            }}
          >
            <AxisHandle
              kind="row"
              at={rowIdx}
              on={sel?.kind === 'row' && sel.at === rowIdx}
              label={t('NotesEditor', 'TableRowActions', { 0: rowIdx + 1 })}
              dragged={dragged}
              onDown={onHandleDown}
            >
              <AxisMenuItems
                node={node}
                apply={apply}
                clearSelection={clearSelection}
                kind="row"
                at={rowIdx}
              />
            </AxisHandle>
          </div>

          {/* Only the two boundaries of the column you are in: a hit strip on every
              edge is nine invisible controls sitting on top of the text you are
              trying to click into. */}
          {Array.from({ length: cols }, (_unused, index) => {
            const live = resizing === index || near?.col === index || near?.col === index + 1
            return (
              <div
                key={`w${index}`}
                onPointerDown={(event) => onResizeDown(event, index)}
                className={cn('notes-table-resize', live ? 'cursor-col-resize' : 'pointer-events-none')}
                style={{ left: grid.x[index + 1] - 4, top: 0, height }}
              >
                <span data-on={resizing === index ? 'true' : undefined} />
              </div>
            )
          })}

          <Rail
            kind="col"
            label={t('NotesEditor', 'TableAddColumn')}
            style={{
              left: width + GAP,
              top: 0,
              width: 14,
              height,
              ...shown(Boolean(near?.right) || growing === 'col'),
            }}
            onPointerDown={(event) => onRailDown(event, 'col')}
          />
          <Rail
            kind="row"
            label={t('NotesEditor', 'TableAddRow')}
            style={{
              left: 0,
              top: height + GAP,
              width: width || undefined,
              height: 14,
              ...shown(Boolean(near?.bottom) || growing === 'row'),
            }}
            onPointerDown={(event) => onRailDown(event, 'row')}
          />

          {/* A zero-size anchor where the press landed, so the styled menu can be
              raised at the pointer without a second menu implementation. */}
          <Menu open={menuAt !== null} onOpenChange={(open) => !open && setMenuAt(null)}>
            <MenuTrigger asChild>
              <span
                aria-hidden
                className="pointer-events-none absolute block size-0"
                style={{ left: menuAt?.x ?? 0, top: menuAt?.y ?? 0 }}
              />
            </MenuTrigger>
            <MenuContent align="start">
              <CellMenuItems node={node} apply={apply} clearSelection={clearSelection} rect={rect} />
            </MenuContent>
          </Menu>
        </>
      ) : null}
    </>
  )
}

/**
 * The handle for one row or column.
 *
 * One control, pressed once. The press selects, the click that finishes the press
 * opens the menu, and a drag instead of a click reorders, so the three things you
 * can want from a column are three ways of putting a finger on the same object
 * rather than a queue of clicks.
 *
 * It still has two looks, because they say different things: a quiet bar for
 * "this column is a thing you can hold", and the filled handle for "and now it is
 * the one being talked about". The hit target is the whole strip either way, so
 * nothing moves under the pointer between the press and the click.
 */
function AxisHandle({
  kind,
  at,
  on,
  label,
  dragged,
  onDown,
  children,
}: {
  kind: 'row' | 'col'
  at: number
  on: boolean
  label: string
  dragged: React.RefObject<boolean>
  onDown: (event: ReactPointerEvent, kind: 'row' | 'col', at: number) => void
  children: React.ReactNode
}) {
  return (
    <div
      onPointerDown={(event) => onDown(event, kind, at)}
      // A drag ends in a click on this element, and that click must not also open
      // the menu the element is carrying. Consumed here rather than on a timer, so
      // it can never outlive the drag that set it.
      onClickCapture={(event) => {
        if (!dragged.current) return
        dragged.current = false
        event.preventDefault()
        event.stopPropagation()
      }}
      className="size-full"
    >
      <Menu>
        <MenuTrigger asChild>
          <button type="button" tabIndex={-1} aria-label={label} className="notes-table-handle">
            <span data-on={on ? 'true' : undefined} data-axis={kind}>
              {on ? <Dots kind={kind} /> : null}
            </span>
          </button>
        </MenuTrigger>
        <MenuContent align="start">{children}</MenuContent>
      </Menu>
    </div>
  )
}

/** Six dots, laid out along the axis they belong to. */
function Dots({ kind }: { kind: 'row' | 'col' }) {
  return (
    <span aria-hidden className={cn('notes-table-dots', kind === 'col' ? 'grid-cols-3 grid-rows-2' : 'grid-cols-2 grid-rows-3')}>
      {Array.from({ length: 6 }, (_unused, index) => (
        <span key={index} />
      ))}
    </span>
  )
}

/**
 * The add rail: a long thin bar rather than a button at one end, so the target is
 * the whole edge and "add a row" is wherever you happen to be looking. The plus is
 * centred because that is where the eye lands, not because that is the part that
 * works.
 */
function Rail({
  kind,
  label,
  style,
  onPointerDown,
}: {
  kind: 'row' | 'col'
  label: string
  style: CSSProperties
  onPointerDown: (event: ReactPointerEvent) => void
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={label}
      onPointerDown={onPointerDown}
      style={style}
      className={cn('notes-table-rail', kind === 'row' ? 'cursor-s-resize' : 'cursor-e-resize')}
    >
      <AppIcon name="plus" size={13} />
    </button>
  )
}
