import { Sparkline } from "@/components/charts/Sparkline"
import { useT } from "@/i18n/useT"
import { useMeasuredWidth } from "@/lib/useMeasuredWidth"

import type { WidgetProps } from "../registry"
import { WidgetError, WidgetLoading, WidgetMessage } from "../states"
import { useFlashcardTests } from "./useFlashcardTests"
import type { ScoreTrend } from "./tests"

const NS = "FlashcardTests"

/** How tall the score line is drawn. Taller than Memory's, which sits under a caption. */
const TREND_HEIGHT = 46

/** U+25B2 and U+25BC. The arrow carries the direction on its own, so the colour is not the only cue. */
const ARROWS: Record<ScoreTrend, string> = { up: "▲", down: "▼", none: "" }

function deltaClass(trend: ScoreTrend): string {
  if (trend === "up") return "text-[var(--toast-accent-success)]"
  return trend === "down" ? "text-[var(--floating-chrome-danger)]" : "text-text-tertiary"
}

/**
 * The most recently tested deck's score, its movement, and its best.
 *
 * The headline is the plain text colour here rather than the accent Memory uses. The two tiles sit
 * side by side on the default board, and accenting both would leave nothing marked out.
 */
export function FlashcardTestsWidget({ instance }: WidgetProps) {
  const t = useT()
  const tests = useFlashcardTests()
  const { ref, width } = useMeasuredWidth<HTMLDivElement>()

  if (tests.state === "loading") return <WidgetLoading rows={3} />
  if (tests.state === "error") return <WidgetError onRetry={tests.retry} />
  if (tests.state === "empty") return <WidgetMessage>{t(NS, "EmptyState")}</WidgetMessage>

  const narrow = instance.size.columns <= 1

  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-caption text-text-tertiary">{t(NS, "Subtitle")}</span>

      <div className="flex items-center gap-4">
        <div className="min-w-0 shrink-0">
          <div className="truncate text-caption font-medium text-text-secondary">{tests.deckName}</div>
          <div className="text-heading-3 font-semibold text-text-primary">{tests.latestPercent}%</div>

          <div className={`mt-0.5 text-caption ${deltaClass(tests.trend)}`}>
            {/* An em dash when there is no earlier attempt to compare against. A "0%" there would
                claim the score held steady, which is not what a first attempt did. */}
            {tests.trend === "none" ? "—" : `${ARROWS[tests.trend]} ${tests.deltaPercent}%`}
          </div>

          <div className="mt-0.5 text-caption text-text-tertiary">
            {t(NS, "BestScoreFormat", { 0: tests.bestPercent })}
          </div>
        </div>

        {narrow ? null : (
          <div ref={ref} className="min-w-0 flex-1">
            <Sparkline
              values={tests.scores}
              width={width}
              height={TREND_HEIGHT}
              className="text-brand"
              dotClassName="text-brand"
            />
          </div>
        )}
      </div>
    </div>
  )
}
