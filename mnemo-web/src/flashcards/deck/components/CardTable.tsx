import type { CardPageDto, DeckSummaryDto } from "@/api/types"
import { AppIcon } from "@/components/icon/AppIcon"
import { Checkbox } from "@/components/ui/checkbox"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import { PAGE_SIZE, pageRange, selectAllState } from "../cards"
import { useDeckView } from "../store"
import { CardRow, type CardRowActions } from "./CardRow"
import { BACK_CELL, ROW_GRID } from "./rowLayout"

/** The column header, the rows and the count-and-pager footer. */
export function CardTable({
  page,
  deckTotal,
  moveTargets,
  actions,
  now,
}: {
  page: CardPageDto
  /** Cards in the deck, which is not the same as cards the filter matched. */
  deckTotal: number
  moveTargets: DeckSummaryDto[]
  actions: CardRowActions
  now: number
}) {
  const t = useT()
  const fc = (key: string, params?: Record<string, string | number>) => t("Flashcards", key, params)

  const selected = useDeckView((s) => s.selected)
  const toggleCard = useDeckView((s) => s.toggleCard)
  const setPageSelection = useDeckView((s) => s.setPageSelection)
  const sortDescending = useDeckView((s) => s.sortDescending)
  const toggleDueSort = useDeckView((s) => s.toggleDueSort)
  const offset = useDeckView((s) => s.offset)
  const setOffset = useDeckView((s) => s.setOffset)

  const pageIds = page.items.map((item) => item.card.id)
  const allState = selectAllState(pageIds, selected)
  const { first, last } = pageRange(offset, page.totalCount)
  const pages = Math.max(1, Math.ceil(page.totalCount / PAGE_SIZE))
  const current = Math.floor(offset / PAGE_SIZE) + 1

  return (
    <div className="mt-3">
      <div className={cn(ROW_GRID, "h-8 border-b border-line-soft text-[11.5px] text-ink-3")}>
        <Checkbox
          checked={allState}
          // An indeterminate box resolves to "select all", so decide from the
          // current state rather than the value the control would report next.
          onToggle={() => setPageSelection(pageIds, allState !== true)}
          label={fc("SelectAllCards")}
        />
        <span />
        <span>{fc("ColFront")}</span>
        <span className={BACK_CELL}>{fc("ColBack")}</span>
        <span>{fc("ColState")}</span>
        {/* Due is the only sortable column, as on the desktop. */}
        <button type="button" onClick={toggleDueSort} className="flex items-center justify-end gap-1 hover:text-ink">
          {fc("ColDue")}
          <AppIcon name={sortDescending ? "chevron-down" : "chevron-up"} size={10} />
        </button>
        <span className="text-right">{fc("ColLapses")}</span>
        <span />
      </div>

      <div role="rowgroup">
        {page.items.map((view) => (
          <CardRow
            key={view.card.id}
            view={view}
            selected={selected.has(view.card.id)}
            onToggleSelect={toggleCard}
            moveTargets={moveTargets}
            actions={actions}
            now={now}
          />
        ))}
      </div>

      <div className="flex h-10 items-center justify-between px-2 text-[12.5px] text-ink-3">
        <span>
          {fc("DeckPageRangeFormat", { 0: first, 1: last, 2: page.totalCount })}
          {page.totalCount === deckTotal ? null : (
            <>
              {" · "}
              {fc("DeckInDeckFormat", { 0: deckTotal.toLocaleString() })}
            </>
          )}
        </span>

        {pages > 1 ? (
          <span className="flex items-center gap-1">
            <PagerButton
              icon="chevron-left"
              label={t("Common", "Previous")}
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            />
            <span className="tabular-nums">
              {current} / {pages}
            </span>
            <PagerButton
              icon="chevron-right"
              label={t("Common", "Next")}
              disabled={offset + PAGE_SIZE >= page.totalCount}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            />
          </span>
        ) : null}
      </div>
    </div>
  )
}

function PagerButton({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: "chevron-left" | "chevron-right"
  label: string
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="grid size-7 place-items-center rounded-md text-ink-3 transition-colors hover:bg-frame-hover hover:text-ink disabled:pointer-events-none disabled:opacity-35"
    >
      <AppIcon name={icon} size={15} />
    </button>
  )
}
