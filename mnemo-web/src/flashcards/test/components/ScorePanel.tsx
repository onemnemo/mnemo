import type { CardDto, TestResultDto } from "@/api/types"
import { Sparkline } from "@/components/charts/Sparkline"
import { AppIcon } from "@/components/icon/AppIcon"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/useT"

import { promptText } from "../../study"
import { deltaMessage, roundPercent, scorePct, tested, type TestTally } from "../test"

/**
 * The end-of-test score. The percentage comes from the tally on screen rather than from the
 * recorded attempt, so it is there the moment the last card is graded; the comparisons - better
 * than last time, the best, the trend - need the write to have landed and appear when it does.
 *
 * The mix comes before the number: "78%" does not say whether you half-knew nine cards or flatly
 * missed two, and the list of what you missed is the thing you actually act on next.
 */
export function ScorePanel({
  deckName,
  tally,
  result,
  failed,
  missed,
  onRetake,
  onBackToDeck,
}: {
  deckName: string
  tally: TestTally
  result: TestResultDto | null
  failed: boolean
  /** The cards graded "missed", in queue order, for the list at the foot of the panel. */
  missed: CardDto[]
  /** Starts a fresh test over the missed cards; shown only when there are any. */
  onRetake: () => void
  onBackToDeck: () => void
}) {
  const t = useT()
  const fc = (key: string, params?: Record<string, string | number>) => t("Flashcards", key, params)
  const percent = (value: number) => fc("TestScorePercentFormat", { 0: roundPercent(value) })

  const total = tested(tally)
  const delta = result ? deltaMessage(result.deltaVsPrevious) : null

  const segments = [
    { value: tally.gotIt, className: "bg-ok" },
    { value: tally.close, className: "bg-state-learn" },
    { value: tally.missed, className: "bg-danger" },
  ]

  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[560px] px-6 pt-6 pb-16">
        <span className="text-[44px] leading-none font-semibold tracking-[-0.03em] tabular-nums text-ink">
          {percent(scorePct(tally))}
        </span>
        <p className="mt-1.5 text-[13.5px] text-ink-2">{deckName}</p>

        <div className="mt-6 flex h-2 overflow-hidden rounded-full bg-canvas-sunken">
          {segments.map((s, i) =>
            s.value > 0 && total > 0 ? (
              <span key={i} className={s.className} style={{ width: `${(s.value / total) * 100}%` }} />
            ) : null,
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-4 text-[12.5px] tabular-nums">
          <Legend dot="bg-ok" count={tally.gotIt} label={fc("GradeGotIt")} />
          <Legend dot="bg-state-learn" count={tally.close} label={fc("TestGradeClose")} />
          <Legend dot="bg-danger" count={tally.missed} label={fc("TestGradeMissed")} />
        </div>

        <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-line-soft pt-5 text-[13px]">
          {delta && (
            <span className="text-ink-2">
              {fc(delta.key, { 0: delta.amount })}
            </span>
          )}
          {failed && <span className="text-ink-3">{fc("TestDeltaUnavailable")}</span>}
          {result?.hasBest && (
            <span className="text-ink-2">
              {fc("TestBestLabel")} <span className="font-semibold text-ok-ink">{percent(result.bestScorePct)}</span>
            </span>
          )}
        </div>

        {result && result.trend.length >= 2 && (
          <div className="mt-6 flex flex-col gap-1.5">
            <span className="text-[11px] text-ink-3">{fc("TestTrendLabel")}</span>
            <Sparkline values={result.trend} />
          </div>
        )}

        {missed.length > 0 && (
          <div className="mt-8">
            <p className="text-[12px] font-medium text-ink-3">{fc("TestWhatYouMissed")}</p>
            <div className="mt-2 [&>*+*]:border-t [&>*+*]:border-line-soft">
              {missed.map((card) => (
                <p key={card.id} className="truncate py-2 text-[13px] text-ink-2">
                  {promptText(card)}
                </p>
              ))}
            </div>
          </div>
        )}

        <div className="mt-8 flex items-center gap-2">
          {missed.length > 0 && (
            <Button icon={<AppIcon name="rotate-ccw" size={14} />} onClick={onRetake}>
              {fc("TestRetakeMissedFormat", { 0: missed.length })}
            </Button>
          )}
          <Button variant={missed.length > 0 ? "ghost" : "solid"} onClick={onBackToDeck}>
            {fc("BackToDeck")}
          </Button>
        </div>
      </div>
    </div>
  )
}

function Legend({ dot, count, label }: { dot: string; count: number; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-ink-2">
      <span className={`size-[6px] rounded-full ${dot}`} /> {count} {label}
    </span>
  )
}
