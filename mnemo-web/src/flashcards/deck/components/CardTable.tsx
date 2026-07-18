import type { CardPageDto, DeckSummaryDto } from "@/api/types"
import { AppIcon } from "@/components/icon/AppIcon"
import { Checkbox } from "@/components/ui/checkbox"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import { PAGE_SIZE, pageRange, selectAllState } from "../cards"
import { useDeckView } from "../store"
import { CardRow, type CardRowActions } from "./CardRow"
import { ROW_GRID } from "./rowLayout"

/** The bordered card holding the column header, the rows and the pager footer. */
export function CardTable({
  page,
  moveTargets,
  actions,
  now,
}: {
  page: CardPageDto
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

  return (
    // Header and pager are sticky rows inside the one scroll container rather than
    // siblings around it. As siblings they sat outside the scrollbar's gutter, so
    // every column right of Front drew ~15px adrift of its own heading.
    <div className="max-h-[calc(100vh-320px)] overflow-y-auto overscroll-contain rounded-lg border border-line bg-surface">
      <div className={cn(ROW_GRID, "sticky top-0 z-10 h-[34px] border-b border-divider-subtle bg-surface")}>
        <Checkbox
          checked={allState}
          // An indeterminate box resolves to "select all", so decide from the
          // current state rather than the value the control would report next.
          onToggle={() => setPageSelection(pageIds, allState !== true)}
          label={fc("ColFront")}
        />
        <HeadCell>{fc("ColFront")}</HeadCell>
        <HeadCell>{fc("ColType")}</HeadCell>
        <HeadCell>{fc("ColTags")}</HeadCell>
        {/* Due is the only sortable column, as on the desktop. */}
        <button type="button" onClick={toggleDueSort} className="flex items-center justify-end gap-1">
          <HeadCell>{fc("ColDue")}</HeadCell>
          <AppIcon name={sortDescending ? "common/chevron-down" : "common/chevron-up"} size={10} className="text-text-faded" />
        </button>
        <HeadCell className="text-right">{fc("ColLapses")}</HeadCell>
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

      {page.totalCount > PAGE_SIZE ? (
        <div className="sticky bottom-0 z-10 flex h-[34px] items-center justify-between border-t border-divider-subtle bg-[var(--widget-background-hover)] px-[14px]">
          <span className="text-caption text-text-tertiary">
            {fc("DeckPageRangeFormat", { 0: first, 1: last, 2: page.totalCount })}
          </span>
          <div className="flex items-center gap-1">
            <PagerButton
              icon="common/chevron-left"
              label={t("Common", "Previous")}
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            />
            <PagerButton
              icon="common/chevron-right"
              label={t("Common", "Next")}
              disabled={offset + PAGE_SIZE >= page.totalCount}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}

function HeadCell({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("text-caption font-semibold text-text-faded", className)}>{children}</span>
}

function PagerButton({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: "common/chevron-left" | "common/chevron-right"
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
      className="grid h-[22px] w-6 place-items-center rounded-md text-text-secondary hover:bg-surface-subtle disabled:pointer-events-none disabled:opacity-35"
    >
      <AppIcon name={icon} size={14} />
    </button>
  )
}
