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

/** The three kinds of work a deck can have waiting, in the order they are always shown. */
export interface WorkCounts {
  new: number
  learning: number
  due: number
}

const COUNT_TONE = {
  new: { text: "text-state-new", key: "ColNew" },
  learning: { text: "text-state-learn", key: "ColLearn" },
  due: { text: "text-state-due", key: "ColDue" },
} as const

export type CountKind = keyof typeof COUNT_TONE

/**
 * A count that dims to nothing at zero.
 *
 * The old table printed a grey 0 in every empty cell, so a deck with nothing to do
 * looked exactly as busy as one with work waiting: the eye had to read digits
 * instead of scanning.
 */
export function Count({ value, kind }: { value: number; kind: CountKind }) {
  const t = useT()
  const tone = COUNT_TONE[kind]
  return (
    <span
      title={`${value} ${t("Flashcards", tone.key)}`}
      className={cn("text-[13px] font-medium tabular-nums", value > 0 ? tone.text : "text-ink-3/45")}
    >
      {value}
    </span>
  )
}

/** new, learning, due in a fixed rhythm so the columns line up down the list. */
export function Counts({ counts, className }: { counts: WorkCounts; className?: string }) {
  return (
    <span className={cn("flex items-center gap-4", className)}>
      <span className="w-7 text-right">
        <Count value={counts.new} kind="new" />
      </span>
      <span className="w-7 text-right">
        <Count value={counts.learning} kind="learning" />
      </span>
      <span className="w-7 text-right">
        <Count value={counts.due} kind="due" />
      </span>
    </span>
  )
}

/** The mix of work waiting, as one bar. A deck with nothing waiting draws nothing at all. */
export function MixBar({ counts, className }: { counts: WorkCounts; className?: string }) {
  const total = counts.new + counts.learning + counts.due
  if (total === 0) return null

  const segments = [
    { value: counts.new, fill: "bg-state-new" },
    { value: counts.learning, fill: "bg-state-learn" },
    { value: counts.due, fill: "bg-state-due" },
  ]
  return (
    <span className={cn("flex h-1.5 overflow-hidden rounded-full bg-canvas-sunken", className)}>
      {segments.map((segment) =>
        segment.value > 0 ? (
          <span key={segment.fill} className={segment.fill} style={{ width: `${(segment.value / total) * 100}%` }} />
        ) : null,
      )}
    </span>
  )
}

/** Below this the bar warns rather than reports. Matches the desktop's own threshold. */
const RETENTION_WARN = 85

/**
 * Scheduled reviews a deck needs before its retention is worth a number.
 *
 * True retention is a pass rate, so a deck with one passed review reads 100% and can only fall
 * from there. Holding the number back until the sample is real keeps a freshly-started deck from
 * greeting the reader with a triumphant, meaningless 100 that instantly drops.
 */
export const RETENTION_MIN_SAMPLE = 20

/** The retention to show, or null while the sample is still too small to mean anything. */
export function retentionReading(percent: number, sampleSize: number): number | null {
  return sampleSize >= RETENTION_MIN_SAMPLE ? percent : null
}

/**
 * Remembered-percentage as a bar plus its number.
 *
 * `null` means there is not yet a meaningful sample, and it has to look different from 0%: an
 * empty bar over a literal "0%" reads as "you have forgotten everything" rather than "no data
 * yet". The tooltip says what would make the number appear so the dash does not read as broken.
 */
export function Retention({ percent }: { percent: number | null }) {
  const t = useT()
  if (percent === null)
    return (
      <span className="text-[12.5px] text-ink-3/60" title={t("Flashcards", "RetentionPending", { 0: RETENTION_MIN_SAMPLE })}>
        —
      </span>
    )

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

/**
 * The same reading as a dial, for the grid tile where there is no room for a bar
 * and a label side by side.
 */
export function Ring({ percent, size = 36 }: { percent: number | null; size?: number }) {
  const t = useT()
  const stroke = 3
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const value = percent === null ? null : Math.min(100, Math.max(0, percent))

  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
      title={value === null ? t("Flashcards", "RetentionPending", { 0: RETENTION_MIN_SAMPLE }) : undefined}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={stroke} className="stroke-canvas-sunken" />
        {value === null ? null : (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - value / 100)}
            className="stroke-ink-2"
          />
        )}
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-medium tabular-nums text-ink-2">
        {value === null ? "—" : value}
      </span>
    </span>
  )
}
