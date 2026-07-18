import type { StudySessionDto } from "@/api/types"
import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import { progressFillWidth } from "../session"

/**
 * The session's own bar, below the app topbar. The left side (close, deck, mode) stays put in
 * every state; the counters and progress only mean anything while a card is up, so they go with
 * it on the end screens.
 */
export function SessionTopbar({
  session,
  active,
  onClose,
}: {
  session: StudySessionDto | null
  active: boolean
  onClose: () => void
}) {
  const t = useT()
  const fc = (key: string, params?: Record<string, string | number>) => t("Flashcards", key, params)
  const cram = session?.mode === "cram"
  const progress = session?.progress

  return (
    <div className="flex h-11 shrink-0 items-center gap-2.5 border-b border-line bg-card px-2.5">
      <IconBtn icon="common/x" label={fc("StudyClose")} onClick={onClose} />

      <span className="max-w-[240px] shrink-0 truncate text-[12.5px] font-medium">{session?.deckName ?? ""}</span>

      {session && (
        <span
          className={cn(
            "shrink-0 rounded-pill px-2.5 py-[3px] font-semibold text-caption whitespace-nowrap",
            cram
              ? "bg-[var(--toast-icon-badge-warning)] text-[var(--flashcard-state-learning)]"
              : "bg-brand-subtle text-brand",
          )}
        >
          {fc(cram ? "StudyModeChipCram" : "StudyModeChipReview")}
        </span>
      )}

      <div className="flex-1" />

      {active && progress && (
        <>
          <div className="flex items-center gap-2 font-mono text-[11.5px] tabular-nums">
            <Counter count={progress.new} label={fc("StudyCounterNew")} className="text-[var(--flashcard-state-new)]" />
            <Counter
              count={progress.learning}
              label={fc("StudyCounterLearning")}
              className="text-[var(--flashcard-state-learning)]"
            />
            <Counter count={progress.due} label={fc("StudyCounterDue")} className="text-brand" />
          </div>

          <div className="h-1 w-40 shrink-0 overflow-hidden rounded-[2px] bg-[var(--widget-background-primary)]">
            <div
              className={cn("h-full rounded-[2px]", cram ? "bg-[var(--flashcard-state-learning)]" : "bg-brand")}
              style={{ width: `${progressFillWidth(progress)}px` }}
            />
          </div>

          <span className="shrink-0 font-mono text-[11.5px] tabular-nums whitespace-nowrap text-text-secondary">
            {fc("StudyProgressFormat", { 0: progress.completed, 1: progress.total })}
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
