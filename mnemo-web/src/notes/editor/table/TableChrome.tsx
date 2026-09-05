import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import type { Node as PMNode } from 'prosemirror-model'

import { AppIcon } from '@/components/icon/AppIcon'
import { Menu, MenuContent, MenuTrigger } from '@/components/ui/menu'
import { cn } from '@/lib/utils'
import { restoreTextSelection, suppressTextSelection } from '@/lib/dnd/drag-select'
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
  readRectText,
  rectHolds,
  rowCells,
  rowRect,
  setColumnWidth,
  tableRows,
  trimCols,
  trimRows,
  type Rect,
} from './model'
import { trackDrag } from './drag-gesture'
import { AxisMenuItems, CellMenuItems } from './TableMenus'
import { useTableGrid } from './useTableGrid'
import { writeGridToClipboard } from '../../clipboard/table-grid'

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
 *
 * ## A drag can always be put down again
 *
 * The handle, the rail and the resize strip all show their result on the table
 * as you go, so all three answer Escape and a lost pointer by handing the
 * pre-drag table straight back (see {@link trackDrag}). Without that the shape
 * the release was going to roll back is the shape you are left with.
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
 * The four arrows as one step each, plus which end of the cell's text they leave
 * from. Written once so the two axes cannot drift: the sideways pair shipped
 * unhandled, and the outline stayed behind every time the caret crossed a cell
 * boundary left or right.
 */
const ARROWS: Readonly<Record<string, { row: number; col: number; back: boolean }>> = {
  ArrowUp: { row: -1, col: 0, back: true },
  ArrowDown: { row: 1, col: 0, back: false },
  ArrowLeft: { row: 0, col: -1, back: true },
  ArrowRight: { row: 0, col: 1, back: false },
}

type Sel =
  | { kind: 'cells'; rect: Rect }
  | { kind: 'row'; at: number }
  | { kind: 'col'; at: number }

/** Where the caret is inside a table: which cell, and whether it is at either end of its text. */
export interface TableCaret {
  readonly row: number
  readonly col: number
  /** At the very start of the cell's own text, so a backward arrow leaves the cell. */
  readonly atStart: boolean
  /** ...and the same at the other end. */
  readonly atEnd: boolean
}

export interface TableChromeProps {
  node: PMNode
  /** The positioned element every overlay is measured and drawn against. */
  frame: HTMLElement
  /**
   * The padded box the chrome hangs in, and where the pointer is tracked.
   *
   * Not the frame: the handles and the rails sit *outside* the table's own box,
   * and a `pointerleave` on the frame fires in the few pixels between the last
   * cell and the handle you are reaching for. Tracking on the padded box means
   * the whole band the chrome lives in counts as still being on the table.
   */
  scroll: HTMLElement
  editable: boolean
  replaceTable: (
    next: PMNode,
    options?: { caret?: { row: number; col: number }; addToHistory?: boolean },
  ) => void
  focusCell: (row: number, col: number, options?: { edge?: 'start' | 'end'; focus?: boolean }) => void
  /** Where the caret is in this table, read from the document rather than from the DOM. */
  caretCell: () => TableCaret | null
  /**
   * Whether an up or down arrow would leave the caret's textblock, asked of the
   * layout. A cell wraps and now holds explicit line breaks, so "the top line" is
   * a visual fact the document cannot answer; this is ProseMirror's own vertical
   * motion test, the same one it uses to decide the key itself.
   */
  atTextEdge: (dir: 'up' | 'down') => boolean
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
  scroll,
  editable,
  replaceTable,
  focusCell,
  caretCell,
  atTextEdge,
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
  /** Ends a running cell drag, so a note switched mid-drag does not strand its guard. */
  const endCellDrag = useRef<(() => void) | null>(null)

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
    // On the padded box, not the frame: see the note on the `scroll` prop.
    scroll.addEventListener('pointermove', onMove)
    scroll.addEventListener('pointerleave', onLeave)
    return () => {
      scroll.removeEventListener('pointermove', onMove)
      scroll.removeEventListener('pointerleave', onLeave)
    }
  }, [frame, scroll, editable, growing, grid, width, height])

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
      const endDrag = (): void => {
        window.removeEventListener('pointermove', onPointerMove)
        window.removeEventListener('pointerup', endDrag)
        window.removeEventListener('pointercancel', endDrag)
        endCellDrag.current = null
        restoreTextSelection()
      }
      const onPointerMove = (moveEvent: PointerEvent): void => {
        const over = cellAt(document.elementFromPoint(moveEvent.clientX, moveEvent.clientY))
        if (!over) return
        if (!crossed) {
          if (over.row === start.row && over.col === start.col) return
          crossed = true
          // Two answers to one gesture, a ragged text range inside one cell and a
          // clean rectangle across four, is the thing to avoid. The moment the
          // drag leaves its own cell, the caret loses. Dropping the range once is
          // not enough by itself: the browser starts sweeping a fresh one under
          // the rectangle unless the same guard every other drag uses is up, and
          // that guard is a class rather than an inline style because WebKitGTK
          // ignores the unprefixed property written from script.
          ;(document.activeElement as HTMLElement | null)?.blur()
          window.getSelection()?.removeAllRanges()
          suppressTextSelection()
        }
        setSel({ kind: 'cells', rect: { r0: start.row, c0: start.col, r1: over.row, c1: over.col } })
      }
      endCellDrag.current = endDrag
      window.addEventListener('pointermove', onPointerMove)
      window.addEventListener('pointerup', endDrag)
      window.addEventListener('pointercancel', endDrag)
    }

    const onContextMenu = (event: MouseEvent): void => {
      if (!editable) return
      event.preventDefault()
      // Stopped here so the editor's own menu does not also open: two menus for
      // one press, one of them about the wrong thing.
      event.stopPropagation()
      const box = frame.getBoundingClientRect()
      setMenuAt({ x: event.clientX - box.left, y: event.clientY - box.top })
    }

    frame.addEventListener('pointerdown', onDown)
    // The whole padded box, so a right-click on the table's own margin (with a row
    // already held) still answers about that row rather than about nothing.
    scroll.addEventListener('contextmenu', onContextMenu)
    return () => {
      frame.removeEventListener('pointerdown', onDown)
      scroll.removeEventListener('contextmenu', onContextMenu)
      // A drag still running when the table goes away would otherwise keep both
      // its window listeners and the app-wide selection guard.
      endCellDrag.current?.()
    }
  }, [frame, scroll, editable])

  /* -- the context-menu key ---------------------------------------------- */

  /**
   * The keyboard's own way of asking for a menu, which is the only route a
   * keyboard has to any of the cell or table verbs.
   *
   * It cannot be handled beside the right-click, because the two arrive from
   * opposite directions. A press lands on a cell and bubbles *up* to the padded
   * box; the context-menu key targets whatever holds focus, which is the editor's
   * own root, an *ancestor* of the box. So that event never passes the listener
   * above at all, and the test for owning it is the mirror image: the target
   * contains this table rather than being contained by it, and the caret is in one
   * of its cells. Anything else is another block's business.
   *
   * The menu opens under the caret's own cell rather than at the coordinates on
   * the event, which for this key are meaningless.
   */
  useEffect(() => {
    if (!editable) return
    const onKeyboardMenu = (event: MouseEvent): void => {
      const target = event.target
      if (!(target instanceof Node) || !target.contains(frame)) return
      const here = caretCell()
      if (!here) return
      event.preventDefault()
      event.stopPropagation()
      // Keep a range that already holds the caret's cell, for the same reason a
      // right-click does: the menu must be about what the paint says it is about.
      setSel((prev) =>
        rectHolds(prev ? selRect(prev, latest.current) : null, here.row, here.col)
          ? prev
          : { kind: 'cells', rect: { r0: here.row, c0: here.col, r1: here.row, c1: here.col } },
      )
      setMenuAt({ x: grid.x[here.col], y: grid.y[here.row + 1] })
    }
    document.addEventListener('contextmenu', onKeyboardMenu)
    return () => document.removeEventListener('contextmenu', onKeyboardMenu)
  }, [frame, editable, caretCell, grid])

  /* -- keyboard ---------------------------------------------------------- */

  /**
   * Bound on the document, in the capture phase, and not on the table.
   *
   * The caret lives in ProseMirror's own contentEditable root, so that is where a
   * keystroke fires; the table's frame is a *descendant* of it and never sees the
   * event at all. Bound there, every key below was dead in the running editor and
   * ProseMirror's fallback took the arrows, which walks the cells in document
   * order: up landed one cell to the left and down one cell to the right.
   *
   * Capture rather than bubble, because ProseMirror's own handler sits on a
   * deeper element and would otherwise act first. That makes the gate strict on
   * purpose: this editor's subtree, this table's caret, and only the keys the
   * table actually owns. Everything else falls through untouched.
   */
  useEffect(() => {
    if (!editable) return

    const goTo = (row: number, col: number, edge: 'start' | 'end' = 'start'): void => {
      focusCell(row, col, { edge })
      setSel({ kind: 'cells', rect: { r0: row, c0: col, r1: row, c1: col } })
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      // This editor's subtree: the root the caret is in contains the table.
      const target = event.target
      if (!(target instanceof Node) || !target.contains(frame)) return

      const table = latest.current
      const rowCount = tableRows(table).length
      const colCount = columnCount(table)
      const here = caretCell()

      /**
       * The caret is this table's licence to answer a key, and every table in the
       * note is asked about every keystroke, because the gate above can only test
       * that the event came from *an* editor containing this one.
       *
       * Without this, a row left selected went on owning Backspace after the caret
       * had moved to another block entirely: pressing it in a code block wiped a
       * row of a table further up the page instead of deleting a character. Escape
       * was swallowed the same way. So a caret that is not in this table takes the
       * paint with it, and the key falls through untouched to whatever the caret
       * is actually in.
       */
      if (!here) {
        if (sel) setSel(null)
        return
      }

      // Copy or cut a cell rectangle. The paint is chrome state, invisible to the
      // editor's own clipboard, so the grid is written here as tab separated text
      // and an HTML table, the two a spreadsheet reads. A single cell is left to
      // the ordinary text copy; only a real rectangle is a grid.
      if ((event.ctrlKey || event.metaKey) && !event.altKey) {
        const key = event.key.toLowerCase()
        if ((key === 'c' || key === 'x') && sel) {
          const rect = selRect(sel, table)
          if (!(sel.kind === 'cells' && isSingleCell(rect))) {
            event.preventDefault()
            event.stopPropagation()
            void writeGridToClipboard(readRectText(table, rect))
            if (key === 'x') apply(clearRect(table, rect))
            return
          }
        }
      }

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

      if (event.key === 'Tab') {
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

      const arrow = ARROWS[event.key]
      if (arrow) {
        // Shift extends a text selection, which is ProseMirror's to grow, and the
        // cell's isolating walls already stop it at the cell's own edge.
        if (event.shiftKey) return
        // Only from the ends of the cell's own text, so the cell is walked before
        // the grid is. The two axes ask different things because they *are*
        // different questions: up and down ask the layout (endOfTextblock), since a
        // wrapped or multi-line cell has lines the document knows nothing about;
        // left and right ask the document, which is exact, where the DOM would
        // answer about the text node the caret is in and jump a column out of the
        // middle of a sentence with a bold word in it.
        const leaving =
          arrow.col === 0
            ? atTextEdge(arrow.row < 0 ? 'up' : 'down')
            : arrow.back
              ? here.atStart
              : here.atEnd
        if (!leaving) return

        let row = here.row + arrow.row
        let col = here.col + arrow.col
        // Sideways off one end continues on the next row along, which is where the
        // caret was going anyway. Taking the key is only so the outline goes too:
        // left it to ProseMirror, the caret moved and the black cell stayed put,
        // which is the one thing the outline exists not to do.
        if (col < 0) {
          col = colCount - 1
          row -= 1
        } else if (col >= colCount) {
          col = 0
          row += 1
        }
        // Off the grid entirely: the caret is leaving the table, and getting out
        // is ProseMirror's business.
        if (row < 0 || row >= rowCount) return
        event.preventDefault()
        event.stopPropagation()
        // Arriving from the right lands on the right, so the next press walks the
        // text of the cell just entered rather than leaving it again.
        goTo(row, col, arrow.back && arrow.col !== 0 ? 'end' : 'start')
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [frame, editable, sel, apply, replaceTable, focusCell, caretCell, atTextEdge])

  /* -- the pointer, when it lands somewhere else ------------------------- */

  /**
   * A press into another block drops whatever this table had selected.
   *
   * The keyboard gate above does this too, but only on the next keystroke, and a
   * black cell left standing in a table you clicked away from reads as though it
   * were still the thing being talked about. Capture, so it is decided before the
   * press reaches whatever it landed on.
   *
   * "Into another block" is the exact scope, and getting it wrong is what broke
   * every menu. A press has to be *inside the editor's own content* to count: the
   * table's menus are portalled onto the body, so a press on a menu item is not
   * in the editable root at all, and clearing the selection there swapped the cell
   * menu to its table-settings fallback out from under the pointer, so the item
   * released on nothing. So a press that is not in the editable root, or is in
   * this table's own box, is left alone; only one that landed in another block
   * clears the paint.
   */
  useEffect(() => {
    if (!editable) return
    const root = frame.closest('.ProseMirror')
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (scroll.contains(target)) return
      if (!root || !root.contains(target)) return
      setSel((prev) => (prev === null ? prev : null))
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [frame, scroll, editable])

  /* -- the handle: one control, three outcomes --------------------------- */

  /**
   * Press selects, click opens, drag reorders.
   *
   * Not a bar that one click turns into a handle for a second click to open: that is two
   * presses on the same three millimetres of screen, the first of which does nothing you
   * can use. There is only one column it could be talking about by the time you have reached
   * for it, so the press does the selecting and the click that completes it does the opening.
   */
  const onHandleDown = (event: ReactPointerEvent, kind: 'row' | 'col', at: number): void => {
    if (event.button !== 0) return
    setSel(kind === 'row' ? { kind: 'row', at } : { kind: 'col', at })
    // The document's caret goes into the run as well, without focus, because the
    // caret is what says which table the keyboard is talking to. Without this a
    // row grabbed from cold leaves the caret in whatever block it was last in, and
    // the verbs the selection exists for answer about that block instead.
    focusCell(kind === 'row' ? at : 0, kind === 'row' ? 0 : at, { focus: false })
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

    // Nothing has moved yet: this drag only paints where the run would land, so
    // abandoning it is dropping that indicator and reordering nothing. The run
    // the press selected stays selected, which is what the press meant.
    trackDrag({ move: onPointerMove, end: onUp, abort: () => setMove(null) })
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
    const room = Math.floor((scroll.clientWidth - width - REACH) / TABLE_COL_W)
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
      const grew = next > count
      count = next
      replaceTable(shapeFor(count), { addToHistory: false })
      // Keep the growing edge in view. A column added off the right of the pane is
      // a column you have to go looking for to find out whether the drag did
      // anything at all.
      if (kind === 'col' && grew) scroll.scrollLeft = scroll.scrollWidth
    }

    setGrowing(kind)
    preview(1)

    const onPointerMove = (moveEvent: PointerEvent): void => {
      const delta = (kind === 'row' ? moveEvent.clientY : moveEvent.clientX) - start
      preview(Math.max(-spare, Math.min(cap, 1 + Math.floor(delta / step))))
    }

    const onUp = (): void => {
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

    // The preview is the table itself, so a gesture that never reaches its
    // release has to be handed the pre-drag shape back the same way an empty
    // one is. The first row is already on screen by now, and Escape is the way
    // back off it.
    const onAbort = (): void => {
      setGrowing(null)
      replaceTable(table, { addToHistory: false })
    }

    trackDrag({ move: onPointerMove, end: onUp, abort: onAbort })
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
      setResizing(null)
      replaceTable(table, { addToHistory: false })
      if (Math.abs(last - startWidth) < 1) return
      replaceTable(setColumnWidth(table, at, last))
    }
    // The same rollback the release runs, with nothing committed after it.
    const onAbort = (): void => {
      setResizing(null)
      replaceTable(table, { addToHistory: false })
    }
    trackDrag({ move: onPointerMove, end: onUp, abort: onAbort })
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

  /**
   * Whether a piece of chrome is being reached for.
   *
   * A data attribute rather than an inline transition. The timing is the app's
   * (`--duration-reveal` / `--duration-conceal`), and the asymmetry falls out of
   * which state the element is in, so the stylesheet owns it and reducing motion
   * reaches it. Written as a number in JS it could not be overridden at all.
   */
  const shown = (on: boolean): { 'data-shown'?: '' } => (on ? { 'data-shown': '' } : {})

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
            {...shown(colAt >= 0)}
            style={{
              left: grid.x[colIdx],
              width: grid.x[colIdx + 1] - grid.x[colIdx],
              top: -(HANDLE + GAP),
              height: HANDLE,
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
            {...shown(rowAt >= 0)}
            style={{
              top: grid.y[rowIdx],
              height: grid.y[rowIdx + 1] - grid.y[rowIdx],
              left: -(HANDLE + GAP),
              width: HANDLE,
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
                className="notes-table-resize"
                // The state, not a utility class. The chrome layer's own rules sit
                // at a higher specificity than a utility, so a strip told to stand
                // down with one stayed in front of the text regardless.
                data-live={live ? '' : undefined}
                style={{ left: grid.x[index + 1] - 4, top: 0, height }}
              >
                <span data-on={resizing === index ? 'true' : undefined} />
              </div>
            )
          })}

          <Rail
            kind="col"
            label={t('NotesEditor', 'TableAddColumn')}
            shown={Boolean(near?.right) || growing === 'col'}
            style={{ left: width + GAP, top: 0, width: 14, height }}
            onPointerDown={(event) => onRailDown(event, 'col')}
          />
          <Rail
            kind="row"
            label={t('NotesEditor', 'TableAddRow')}
            shown={Boolean(near?.bottom) || growing === 'row'}
            style={{ left: 0, top: height + GAP, width: width || undefined, height: 14 }}
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
              {/* A held row or column is what the press is about; anything else is
                  about the cells under it. */}
              {sel && sel.kind !== 'cells' ? (
                <AxisMenuItems
                  node={node}
                  apply={apply}
                  clearSelection={clearSelection}
                  kind={sel.kind}
                  at={sel.at}
                />
              ) : (
                <CellMenuItems node={node} apply={apply} clearSelection={clearSelection} rect={rect} />
              )}
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
  shown,
  style,
  onPointerDown,
}: {
  kind: 'row' | 'col'
  label: string
  /** Whether the edge it belongs to is being reached for. */
  shown: boolean
  style: CSSProperties
  onPointerDown: (event: ReactPointerEvent) => void
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={label}
      data-shown={shown ? '' : undefined}
      onPointerDown={onPointerDown}
      style={style}
      className={cn('notes-table-rail', kind === 'row' ? 'cursor-s-resize' : 'cursor-e-resize')}
    >
      <AppIcon name="plus" size={13} />
    </button>
  )
}
