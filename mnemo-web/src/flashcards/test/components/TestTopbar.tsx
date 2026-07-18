import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import { progressFillWidth } from "../../study"
import type { TestTally } from "../test"

/**
 * The test's own bar. The amber chip says "practice only" because nothing here touches the
 * schedule, and the tallies stay in their three colours so the run of a test is readable at a
 * glance without a legend.
 */
export function TestTopbar({
  deckName,
  tally,
  completed,
  total,
  active,
  onClose,
}: {
  deckName: string
  tally: TestTally
  completed: number
  total: number
  active: boolean
  onClose: () => void
}) {
  const t = useT()
  const fc = (key: string, params?: Record<string, string | number>) => t("Flashcards", key, params)

  return (
    <div className="flex h-11 shrink-0 items-center gap-2.5 border-b border-line bg-card px-2.5">
      <IconBtn icon="common/x" label={fc("StudyClose")} onClick={onClose} />

      <span className="max-w-[240px] shrink-0 truncate text-[12.5px] font-medium">{deckName}</span>

      <span className="shrink-0 rounded-pill bg-[var(--toast-icon-badge-warning)] px-2.5 py-[3px] font-semibold text-caption whitespace-nowrap text-[var(--flashcard-state-learning)]">
        {fc("TestModeChip")}
      </span>

      <div className="flex-1" />

      {active && (
        <>
          <div className="flex items-center gap-2 font-mono text-[11.5px] tabular-nums">
            <Counter
              count={tally.gotIt}
              label={fc("GradeGotIt")}
              className="text-[var(--flashcard-retention-high)]"
            />
            <Counter
              count={tally.close}
              label={fc("TestGradeClose")}
              className="text-[var(--flashcard-state-learning)]"
            />
            <Counter count={tally.missed} label={fc("TestGradeMissed")} className="text-brand" />
          </div>

          <div className="h-1 w-40 shrink-0 overflow-hidden rounded-[2px] bg-[var(--widget-background-primary)]">
            <div
              className="h-full rounded-[2px] bg-[var(--flashcard-state-learning)]"
              style={{ width: `${progressFillWidth(completed, total)}px` }}
            />
          </div>

          <span className="shrink-0 font-mono text-[11.5px] tabular-nums whitespace-nowrap text-text-secondary">
            {fc("StudyProgressFormat", { 0: completed, 1: total })}
          </span>
        </>
      )}

      {/* No destination yet - the review-settings dialog is still to be built. */}
      <IconBtn icon="flyout/settings" label={fc("ReviewSettingsMenu")} disabled />
    </div>
  )
}

function Counter({ count, label, className }: { count: number; label: string; className: string }) {
  if (count <= 0) return null
  return (
    <span title={label} className={className}>
      {count}
    </span>
  )
}

function IconBtn({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: string
  label: string
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "grid size-[30px] shrink-0 cursor-pointer place-items-center rounded-sm text-text-secondary",
        "hover:bg-[var(--button-background-pointer-over)] disabled:pointer-events-none disabled:opacity-35",
      )}
    >
      <AppIcon name={icon} size={16} />
    </button>
  )
}
