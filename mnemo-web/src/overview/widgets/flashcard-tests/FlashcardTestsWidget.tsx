import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import { Body, Empty, Head, Spark, Stat, useWidgetTitle } from "../../parts"
import type { WidgetProps } from "../registry"
import { WidgetError, WidgetLoading } from "../states"
import type { ScoreTrend } from "./tests"
import { useFlashcardTests } from "./useFlashcardTests"

const NS = "FlashcardTests"

/** U+25B2 and U+25BC. The arrow carries the direction on its own, so the colour is not the only cue. */
const ARROWS: Record<ScoreTrend, string> = { up: "▲", down: "▼", none: "" }

function deltaClass(trend: ScoreTrend): string {
  if (trend === "up") return "text-state-new"
  return trend === "down" ? "text-danger" : "text-ink-3"
}

/**
 * The most recently tested deck's score, its movement, and its best.
 *
 * The headline is plain ink rather than the ring Memory uses. The two tiles sit side by side on the
 * default board, and giving both the same treatment would leave neither marked out.
 */
export function FlashcardTestsWidget({ instance, manifest }: WidgetProps) {
  const t = useT()
  const title = useWidgetTitle(manifest)
  const tests = useFlashcardTests()

  const narrow = instance.size.columns <= 1

  if (tests.state !== "ready") {
    return (
      <Body>
        <Head title={title} icon="check-check" />
        {tests.state === "loading" ? (
          <div className="mt-2 flex-1">
            <WidgetLoading rows={3} />
          </div>
        ) : tests.state === "error" ? (
          <WidgetError onRetry={tests.retry} />
        ) : (
          <Empty>{t(NS, "EmptyState")}</Empty>
        )}
      </Body>
    )
  }

  return (
    <Body>
      <Head title={title} icon="check-check" right={<span className="truncate text-[11.5px] text-ink-3">{tests.deckName}</span>} />

      <div className="mt-3 flex min-h-0 flex-1 items-center gap-4">
        <div className="min-w-0 shrink-0">
          <Stat value={`${tests.latestPercent}%`} scale={0.8} />
          <p className={cn("mt-1 text-[11.5px] tabular-nums", deltaClass(tests.trend))}>
            {/* An em dash when there is no earlier attempt to compare against. A "0%" there would
                claim the score held steady, which is not what a first attempt did. */}
            {tests.trend === "none" ? "—" : `${ARROWS[tests.trend]} ${tests.deltaPercent}%`}
          </p>
          <p className="mt-0.5 text-[11.5px] text-ink-3">{t(NS, "BestScoreFormat", { 0: tests.bestPercent })}</p>
        </div>

        {!narrow && tests.scores.length > 1 && (
          <div className="min-h-0 min-w-0 flex-1 self-stretch py-1 text-ink-3">
            <Spark values={tests.scores} />
          </div>
        )}
      </div>
    </Body>
  )
}
