import type { DueCountsDto } from "@/api/types"
import { useT } from "@/i18n/useT"

import { estimatedMinutes } from "../tree"

/**
 * The "N cards due today" summary. Informational only — the desktop banner has
 * no actions either, and its counts cover every deck regardless of any search.
 */
export function DueBanner({ due, deckCount }: { due: DueCountsDto; deckCount: number }) {
  const t = useT()
  const fc = (key: string, params?: Record<string, string | number>) => t("Flashcards", key, params)

  return (
    <div className="rounded-lg border border-line bg-surface px-[18px] py-[13px] text-right">
      <p className="text-body-small font-semibold text-text-primary">
        {fc("DueTodayCountFormat", { 0: due.total.toLocaleString() })}
      </p>
      <p className="text-body-extra-small">
        <span className="text-text-tertiary">{fc("DeckCountFormat", { 0: deckCount })}</span>
        <Separator />
        <span className="text-text-tertiary">{fc("EstimatedMinutesFormat", { 0: estimatedMinutes(due.total) })}</span>
        <Separator />
        <span className="text-[var(--flashcard-state-new)]">{fc("SummaryNewFormat", { 0: due.new })}</span>
        <span className="text-text-tertiary">, </span>
        <span className="text-[var(--flashcard-state-learning)]">{fc("SummaryLearnFormat", { 0: due.learning })}</span>
        <span className="text-text-tertiary">, </span>
        <span className="text-[var(--accent)]">{fc("SummaryReviewFormat", { 0: due.due })}</span>
      </p>
    </div>
  )
}

function Separator() {
  return <span className="text-text-tertiary">{"  ·  "}</span>
}
