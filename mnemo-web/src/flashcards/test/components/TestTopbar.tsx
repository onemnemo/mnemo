import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import { useReviewSettings } from "../../presets/store"
import type { TestTally } from "../test"

/**
 * The test's own thin bar. The practice chip says nothing here touches the schedule; the running
 * figure is a count of points, not a percentage - two misses out of three is 33% and reads as a
 * disaster on a test that has barely started, where a count only ever climbs. It stays hidden
 * until there is a card to count, so a green zero never greets the first prompt.
 */
export function TestTopbar({
  deckId,
  deckName,
  tally,
  completed,
  total,
  active,
  onClose,
}: {
  deckId: string | undefined
  deckName: string
  tally: TestTally
  completed: number
  total: number
  active: boolean
  onClose: () => void
}) {
  const t = useT()
  const fc = (key: string, params?: Record<string, string | number>) => t("Flashcards", key, params)
  const points = tally.gotIt + tally.close * 0.5
  const fill = total > 0 ? (completed / total) * 100 : 0

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 px-4">
      <IconBtn icon="common/x" label={fc("StudyClose")} onClick={onClose} />

      <span className="max-w-[240px] shrink-0 truncate text-[13px] font-medium text-ink">{deckName}</span>

      <span className="shrink-0 rounded-md bg-state-learn-wash px-1.5 py-0.5 text-[11.5px] font-medium whitespace-nowrap text-state-learn">
        {fc("TestModeChip")}
      </span>

      <div className="flex-1" />

      {active && (
        <>
          {completed > 0 && (
            <span
              className={cn("text-[12.5px] font-medium tabular-nums", points > 0 ? "text-ok-ink" : "text-ink-3")}
            >
              {points % 1 === 0 ? points : points.toFixed(1)}
            </span>
          )}
          <span className="h-1 w-40 shrink-0 overflow-hidden rounded-full bg-canvas-sunken">
            <span
              className="block h-full rounded-full bg-ink-3 transition-[width] duration-300 ease-out"
              style={{ width: `${fill}%` }}
            />
          </span>
          <span className="shrink-0 text-[12.5px] tabular-nums text-ink-3">
            {fc("StudyProgressFormat", { 0: completed, 1: total })}
          </span>
        </>
      )}

      {/* Only shuffle applies to a test, but the desktop opens the same dialog from here and
          the preset is shared - editing it from a test still changes the deck's reviews. */}
      <IconBtn
        icon="flyout/settings"
        label={fc("ReviewSettingsMenu")}
        disabled={!deckId}
        onClick={() => deckId && useReviewSettings.getState().open(deckId, deckName)}
      />
    </header>
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
        "grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg text-ink-2 transition-colors",
        "hover:bg-frame-hover hover:text-ink disabled:pointer-events-none disabled:opacity-35",
      )}
    >
      <AppIcon name={icon} size={16} />
    </button>
  )
}
