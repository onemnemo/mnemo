import type { CardDto, CardScheduleDto } from "@/api/types"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

/**
 * The small readings the flashcard surfaces share: what state a card is in, how
 * well a deck is remembered. Kept out of the components because the deck page and
 * the library render the same facts at different sizes.
 */

/**
 * What the table calls a card's position in the schedule.
 *
 * Suspended outranks the scheduler: a suspended card is not going to come up
 * whatever FSRS thinks its state is. Relearning folds into learning because the
 * difference is the scheduler's business, not the reader's.
 */
export type CardStateKind = "new" | "learning" | "review" | "suspended"

export function cardStateKind(card: CardDto, schedule: CardScheduleDto): CardStateKind {
  if (card.state === "suspended") return "suspended"
  if (schedule.fsrsState === "new") return "new"
  if (schedule.fsrsState === "review") return "review"
  return "learning"
}

const STATE_STYLE: Record<CardStateKind, { dot: string; text: string; key: string }> = {
  new: { dot: "bg-state-new", text: "text-ink-2", key: "CardStateNew" },
  learning: { dot: "bg-state-learn", text: "text-ink-2", key: "CardStateLearning" },
  review: { dot: "bg-ink-3/50", text: "text-ink-2", key: "CardStateReview" },
  // Hollow, not filled: nothing is scheduled, so there is no work to colour.
  suspended: { dot: "bg-transparent shadow-[0_0_0_1px_var(--ink-3)]", text: "text-ink-3", key: "CardStateSuspended" },
}

export function StateTag({ state }: { state: CardStateKind }) {
  const t = useT()
  const style = STATE_STYLE[state]
  return (
    <span className={cn("flex items-center gap-1.5 text-[12.5px]", style.text)}>
      <span className={cn("size-[6px] shrink-0 rounded-full", style.dot)} />
      {t("Flashcards", style.key)}
    </span>
  )
}

/** Below this the bar warns rather than reports. Matches the desktop's own threshold. */
const RETENTION_WARN = 85

/**
 * Remembered-percentage as a bar plus its number.
 *
 * `null` means never studied, and it has to look different from 0%: an empty bar
 * over a literal "0%" reads as "you have forgotten everything" rather than "no
 * data yet".
 */
export function Retention({ percent }: { percent: number | null }) {
  if (percent === null) return <span className="text-[12.5px] text-ink-3/60">—</span>

  const value = Math.min(100, Math.max(0, percent))
  return (
    <span className="flex items-center gap-2">
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-canvas-sunken">
        <span
          className={cn("block h-full rounded-full", value < RETENTION_WARN ? "bg-state-learn" : "bg-ink-3")}
          style={{ width: `${value}%` }}
        />
      </span>
      <span className="w-8 tabular-nums text-[12.5px] text-ink-2">{value}%</span>
    </span>
  )
}
