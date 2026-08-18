import type { ReactNode } from 'react'
import type { Node as PMNode } from 'prosemirror-model'

import { MenuCheckItem, MenuItem, MenuSectionLabel, MenuSeparator, MenuSubMenu } from '@/components/ui/menu'
import { useT } from '@/i18n/useT'

import {
  clearRect,
  colRect,
  columnCount,
  duplicateCol,
  duplicateRow,
  fillRect,
  headerColumnsOf,
  headerRowsOf,
  insertCols,
  insertRows,
  isSingleCell,
  normalizeRect,
  removeCol,
  removeRow,
  rowCells,
  rowRect,
  tableRows,
  toggleColumnHeader,
  toggleRowHeader,
  type Rect,
} from './model'
import { NO_TINT, tableTints, tintFill, type Tint } from './tints'

/**
 * The table's verbs.
 *
 * Kept apart from the chrome that raises them because there are three ways in
 * (the row handle, the column handle, and right-clicking a cell) and they must
 * name the same things in the same order: a menu whose wording depends on which
 * grip you happened to grab is three features that look like one.
 *
 * Three things deliberately not copied from the surface this is modelled on:
 *
 *   The row menu has no search field. A filter box above six rows costs a
 *   keystroke and saves none; the menu keeps type-ahead, which is the same idea
 *   with no box.
 *
 *   Deleting the last row is refused rather than allowed. A table with nothing in
 *   it has no grip left to add anything back with, so the block would be a dead
 *   rectangle you can only remove, and removing the block is the block menu's job.
 *
 *   The colour rows keep their swatches. A colour menu with no colour in it is
 *   nine words that all mean "some blue".
 */

export interface TableMenuProps {
  node: PMNode
  apply: (next: PMNode) => void
  /** Called when a verb invalidates whatever was selected, e.g. a delete. */
  clearSelection: () => void
}

/**
 * A hairline across an empty square: the mark that means no fill.
 *
 * Written as a gradient rather than a border trick because the square is 14px and
 * the diagonal has to land on its corners exactly. Inline rather than in the
 * stylesheet: the menu is portalled out of the editor, so the note's own sheet
 * does not reach it.
 */
const NO_FILL_MARK =
  'linear-gradient(to top right, transparent calc(50% - 0.5px), var(--ink-3) calc(50% - 0.5px), var(--ink-3) calc(50% + 0.5px), transparent calc(50% + 0.5px))'

/**
 * The square in a colour row.
 *
 * The default gets the struck-through square rather than an empty one. Empty,
 * beside eight filled squares, reads as a ninth colour whose paint failed to
 * load, and the row that takes a colour off is the one that most needs to be
 * recognisable at a glance.
 */
function Swatch({ id }: { id: string }) {
  const fill = tintFill(id)
  return (
    <span
      className="block size-[14px] shrink-0 rounded-[4px]"
      style={{ background: fill ?? NO_FILL_MARK, boxShadow: 'inset 0 0 0 1px var(--line)' }}
    />
  )
}

/** The fill the rectangle's top left cell has, which is what the ticks report. */
function fillOf(node: PMNode, rect: Rect): string {
  const box = normalizeRect(rect)
  const cell = rowCells(tableRows(node)[box.r0] ?? node)[box.c0]
  const fill = cell ? String(cell.attrs.fill ?? '') : ''
  return fill.length > 0 ? fill : NO_TINT
}

function ColorSubMenu({ node, apply, rect }: TableMenuProps & { rect: Rect }) {
  const t = useT()
  const current = fillOf(node, rect)
  const row = (tint: Tint) => (
    <MenuCheckItem
      key={tint.id}
      checked={current === tint.id}
      leading={<Swatch id={tint.id} />}
      onSelect={() => apply(fillRect(node, rect, tint.id === NO_TINT ? '' : tint.id))}
    >
      {t('NotesEditor', tint.labelKey)}
    </MenuCheckItem>
  )
  return (
    <MenuSubMenu label={t('NotesEditor', 'TableColor')} icon="palette">
      {/* Taking the colour off is a different kind of thing from putting one on,
          and listed among the hues it reads as a ninth of them. */}
      {tableTints.filter((tint) => tint.id === NO_TINT).map(row)}
      <MenuSeparator />
      {tableTints.filter((tint) => tint.id !== NO_TINT).map(row)}
    </MenuSubMenu>
  )
}

/**
 * The settings reached from a cell: this cell's own row and column as headers,
 * and the one setting that is genuinely the whole table's.
 *
 * The header toggles name the cell's row and column, not "the first row", so the
 * cell menu says the same thing the row and column grips do: a header is whichever
 * row or column you pointed at. `at` defaults to the top left so the section is
 * still total when it is raised without a cell under it.
 */
export function TableSettingsItems({
  node,
  apply,
  labelled,
  at = { row: 0, col: 0 },
}: TableMenuProps & { labelled?: boolean; at?: { row: number; col: number } }) {
  const t = useT()
  const nt = (key: string) => t('NotesEditor', key)
  const headerRows = headerRowsOf(node)
  const headerColumns = headerColumnsOf(node)
  const setFullWidth = () =>
    apply(node.type.create({ ...node.attrs, fullWidth: node.attrs.fullWidth !== true }, node.content))

  return (
    <>
      {labelled ? <MenuSectionLabel>{nt('TableSectionTable')}</MenuSectionLabel> : null}
      <MenuCheckItem
        checked={headerRows[at.row] === true}
        icon="rows-3"
        onSelect={() => apply(toggleRowHeader(node, at.row))}
      >
        {nt('TableHeaderRow')}
      </MenuCheckItem>
      <MenuCheckItem
        checked={headerColumns[at.col] === true}
        icon="columns-3"
        onSelect={() => apply(toggleColumnHeader(node, at.col))}
      >
        {nt('TableHeaderColumn')}
      </MenuCheckItem>
      <MenuCheckItem checked={node.attrs.fullWidth === true} icon="maximize" onSelect={setFullWidth}>
        {nt('TableFitToWidth')}
      </MenuCheckItem>
    </>
  )
}

/**
 * The row and column menus: six verbs with one axis swapped, written once so the
 * two can never drift apart.
 */
export function AxisMenuItems({
  node,
  apply,
  clearSelection,
  kind,
  at,
}: TableMenuProps & { kind: 'row' | 'col'; at: number }): ReactNode {
  const t = useT()
  const nt = (key: string) => t('NotesEditor', key)
  const isRow = kind === 'row'
  const rect = isRow ? rowRect(node, at) : colRect(node, at)
  const last = isRow ? tableRows(node).length <= 1 : columnCount(node) <= 1
  const isHeader = (isRow ? headerRowsOf(node) : headerColumnsOf(node))[at] === true

  return (
    <>
      <MenuCheckItem
        checked={isHeader}
        icon={isRow ? 'rows-3' : 'columns-3'}
        onSelect={() => apply(isRow ? toggleRowHeader(node, at) : toggleColumnHeader(node, at))}
      >
        {nt(isRow ? 'TableHeaderRow' : 'TableHeaderColumn')}
      </MenuCheckItem>
      <ColorSubMenu node={node} apply={apply} clearSelection={clearSelection} rect={rect} />
      <MenuSeparator />
      <MenuItem
        icon={isRow ? 'arrow-up' : 'arrow-left'}
        onSelect={() => apply(isRow ? insertRows(node, at) : insertCols(node, at))}
      >
        {nt(isRow ? 'TableInsertAbove' : 'TableInsertLeft')}
      </MenuItem>
      <MenuItem
        icon={isRow ? 'arrow-down' : 'arrow-right'}
        onSelect={() => apply(isRow ? insertRows(node, at + 1) : insertCols(node, at + 1))}
      >
        {nt(isRow ? 'TableInsertBelow' : 'TableInsertRight')}
      </MenuItem>
      <MenuItem
        icon="copy-plus"
        onSelect={() => apply(isRow ? duplicateRow(node, at) : duplicateCol(node, at))}
      >
        {nt('TableDuplicate')}
      </MenuItem>
      <MenuItem icon="eraser" onSelect={() => apply(clearRect(node, rect))}>
        {nt('TableClearContents')}
      </MenuItem>
      <MenuSeparator />
      <MenuItem
        icon="trash-2"
        danger
        disabled={last}
        onSelect={() => {
          apply(isRow ? removeRow(node, at) : removeCol(node, at))
          clearSelection()
        }}
      >
        {nt('TableDelete')}
      </MenuItem>
    </>
  )
}

/** The menu a right-click on the cells raises, about whatever is selected. */
export function CellMenuItems({
  node,
  apply,
  clearSelection,
  rect,
}: TableMenuProps & { rect: Rect | null }): ReactNode {
  const t = useT()
  const nt = (key: string, params?: Record<string, string | number>) => t('NotesEditor', key, params)

  if (!rect) {
    return <TableSettingsItems node={node} apply={apply} clearSelection={clearSelection} labelled />
  }

  const box = normalizeRect(rect)
  const rows = box.r1 - box.r0 + 1
  const cols = box.c1 - box.c0 + 1

  const removeRun = (axis: 'row' | 'col') => {
    let next = node
    const from = axis === 'row' ? box.r1 : box.c1
    const to = axis === 'row' ? box.r0 : box.c0
    for (let index = from; index >= to; index--) {
      next = axis === 'row' ? removeRow(next, index) : removeCol(next, index)
    }
    apply(next)
    clearSelection()
  }

  return (
    <>
      <MenuSectionLabel>
        {isSingleCell(box) ? nt('TableSectionCell') : nt('TableSectionCells', { 0: rows, 1: cols })}
      </MenuSectionLabel>
      <ColorSubMenu node={node} apply={apply} clearSelection={clearSelection} rect={box} />
      <MenuItem icon="eraser" onSelect={() => apply(clearRect(node, box))}>
        {nt('TableClearContents')}
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon="arrow-down" onSelect={() => apply(insertRows(node, box.r1 + 1, rows))}>
        {rows === 1 ? nt('TableInsertRowBelow') : nt('TableInsertRowsBelow', { 0: rows })}
      </MenuItem>
      <MenuItem icon="arrow-right" onSelect={() => apply(insertCols(node, box.c1 + 1, cols))}>
        {cols === 1 ? nt('TableInsertColumnRight') : nt('TableInsertColumnsRight', { 0: cols })}
      </MenuItem>
      <MenuSeparator />
      <MenuItem
        icon="trash-2"
        danger
        disabled={tableRows(node).length <= rows}
        onSelect={() => removeRun('row')}
      >
        {rows === 1 ? nt('TableDeleteRow') : nt('TableDeleteRows', { 0: rows })}
      </MenuItem>
      <MenuItem
        icon="trash-2"
        danger
        disabled={columnCount(node) <= cols}
        onSelect={() => removeRun('col')}
      >
        {cols === 1 ? nt('TableDeleteColumn') : nt('TableDeleteColumns', { 0: cols })}
      </MenuItem>
      <MenuSeparator />
      {/* The header toggles name this cell's own row and column, the top left of
          the selection if it spans several. */}
      <TableSettingsItems
        node={node}
        apply={apply}
        clearSelection={clearSelection}
        at={{ row: box.r0, col: box.c0 }}
        labelled
      />
    </>
  )
}
