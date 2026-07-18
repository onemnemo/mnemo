import type { TestResultDto } from "@/api/types"
import { Sparkline } from "@/components/charts/Sparkline"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/useT"

import { deltaMessage, roundPercent, scorePct, type TestTally } from "../test"

/**
 * The end-of-test score. The percentage comes from the tally on screen rather than from the
 * recorded attempt, so it is there the moment the last card is graded; the comparisons - better
 * than last time, the best, the trend - need the write to have landed and appear when it does.
 */
export function ScorePanel({
  tally,
  result,
  failed,
  onBackToDeck,
}: {
  tally: TestTally
  result: TestResultDto | null
  failed: boolean
  onBackToDeck: () => void
}) {
  const t = useT()
  const fc = (key: string, params?: Record<string, string | number>) => t("Flashcards", key, params)
  const percent = (value: number) => fc("TestScorePercentFormat", { 0: roundPercent(value) })

  const delta = result ? deltaMessage(result.deltaVsPrevious) : null

  return (
    <div className="m-auto flex w-full max-w-[440px] flex-col items-center gap-5 p-6 text-center">
      <span className="font-semibold text-caption tracking-[1.2px] text-text-faded">{fc("TestScoreTitle")}</span>

      <span className="font-semibold text-[64px] leading-none">{percent(scorePct(tally))}</span>

      {delta && <p className="text-text-secondary">{fc(delta.key, { 0: delta.amount })}</p>}
      {failed && <p className="text-text-secondary">{fc("TestDeltaUnavailable")}</p>}

      {result && result.trend.length >= 2 && (
        <div className="flex flex-col items-center gap-1.5">
          <span className="text-caption text-text-tertiary">{fc("TestTrendLabel")}</span>
          <Sparkline values={result.trend} />
        </div>
      )}

      {result?.hasBest && (
        <div className="flex items-center gap-1.5 text-body-small">
          <span className="text-text-tertiary">{fc("TestBestLabel")}</span>
          <span className="font-semibold text-[var(--flashcard-retention-high)]">
            {percent(result.bestScorePct)}
          </span>
        </div>
      )}

      <div className="flex items-center gap-2.5">
        <Count value={tally.gotIt} label={fc("GradeGotIt")} className="text-[var(--flashcard-retention-high)]" />
        <Count
          value={tally.close}
          label={fc("TestGradeClose")}
          className="text-[var(--flashcard-state-learning)]"
        />
        <Count value={tally.missed} label={fc("TestGradeMissed")} className="text-brand" />
      </div>

      <Button onClick={onBackToDeck}>{fc("BackToDeck")}</Button>
    </div>
  )
}

function Count({ value, label, className }: { value: number; label: string; className: string }) {
  return (
    <div className="flex items-center gap-1.5 rounded-sm bg-[var(--widget-background-primary)] px-2.5 py-[5px]">
      <span className={`font-mono tabular-nums ${className}`}>{value}</span>
      <span className="text-caption text-text-tertiary">{label}</span>
    </div>
  )
}
