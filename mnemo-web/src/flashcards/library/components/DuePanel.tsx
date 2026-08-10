import type { DueCountsDto } from "@/api/types"
import { AppIcon } from "@/components/icon/AppIcon"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/useT"

import { MixBar } from "../../bits"
import { estimatedMinutes } from "../tree"

/**
 * Today's work and the button that starts it.
 *
 * The count used to sit in a box that was seven eighths empty and had no action in
 * it. Studying is the entire reason the screen exists, so the number and the thing
 * that acts on it are one object.
 */
export function DuePanel({
  due,
  deckCount,
  onStudy,
}: {
  due: DueCountsDto
  /** Decks with something waiting, which is not the same as decks that exist. */
  deckCount: number
  /** Null when nothing is waiting: the button then means "go and study anyway". */
  onStudy: () => void
}) {
  const t = useT()
  const fc = (key: string, params?: Record<string, string | number>) => t("Flashcards", key, params)

  if (due.total === 0) {
    return (
      <div className="mt-5 flex items-center gap-4 rounded-xl bg-canvas-sunken px-5 py-5">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-canvas shadow-[0_0_0_1px_var(--line-soft)]">
          <AppIcon name="sparkles" size={18} strokeWidth={1.6} className="text-ink-2" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium text-ink">{fc("CaughtUpTitle")}</p>
          <p className="mt-0.5 text-[12.5px] text-ink-2">{fc("CaughtUpMessage")}</p>
        </div>
        <Button variant="outline" onClick={onStudy}>
          {fc("StudyAhead")}
        </Button>
      </div>
    )
  }

  return (
    <div className="mt-5 flex items-center gap-6 rounded-xl bg-canvas-sunken px-5 py-4">
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline gap-2">
          <span className="text-[28px] leading-none font-semibold tracking-[-0.02em] tabular-nums text-ink">
            {due.total}
          </span>
          <span className="text-[14px] text-ink-2">{fc("DuePanelCardsDueToday")}</span>
        </p>

        {/* Full width on purpose. Capped short it leaves an empty middle; the bar
            running to the button is what makes the panel read as one object. */}
        <MixBar counts={due} className="mt-3" />

        <p className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ink-2">
          <Legend fill="bg-state-new" label={fc("SummaryNewFormat", { 0: due.new })} />
          <Legend fill="bg-state-learn" label={fc("SummaryLearnFormat", { 0: due.learning })} />
          <Legend fill="bg-state-due" label={fc("SummaryReviewFormat", { 0: due.due })} />
          <span className="text-ink-3">·</span>
          <span className="text-ink-3">
            {deckCount === 1 ? fc("DeckCountSingular") : fc("DeckCountFormat", { 0: deckCount })}
            {" · "}
            {fc("EstimatedMinutesFormat", { 0: estimatedMinutes(due.total) })}
          </span>
        </p>
      </div>

      <Button onClick={onStudy} icon={<AppIcon name="common/play-filled" size={13} />} className="h-9 shrink-0 px-3.5">
        {fc("StudyAll")}
      </Button>
    </div>
  )
}

function Legend({ fill, label }: { fill: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`size-[6px] rounded-full ${fill}`} />
      {label}
    </span>
  )
}
