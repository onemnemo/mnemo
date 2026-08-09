import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import { Body, Head, Stat, useWidgetTitle } from "../../parts"
import type { WidgetProps } from "../registry"
import { WidgetError, WidgetLoading } from "../states"
import { useFlashcardStats } from "./useFlashcardStats"

interface Cell {
  value: number
  ns: string
  key: string
}

/**
 * Four counters: cards, minutes and sessions for today, plus the running streak.
 *
 * Two labels come from the page's own namespace rather than this widget's, which looks like an
 * oversight but is what both apps read from the shipped bundles. Moving them would leave four
 * locales without a translation.
 */
export function FlashcardStatsWidget({ instance, manifest }: WidgetProps) {
  const t = useT()
  const title = useWidgetTitle(manifest)
  const stats = useFlashcardStats()

  const cells: Cell[] = [
    { value: stats.cardsToday, ns: "Overview", key: "PracticedToday" },
    { value: stats.minutesToday, ns: "FlashcardStats", key: "MinutesToday" },
    { value: stats.sessionsToday, ns: "FlashcardStats", key: "SessionsToday" },
    { value: stats.streak, ns: "Overview", key: "Streak" },
  ]

  // The 1x2 tile stacks the same four cells. Nothing about the cells themselves changes; four
  // numbers side by side in a 240px column would each get sixty pixels.
  const isNarrow = instance.size.columns <= 1

  return (
    <Body>
      {/* The scope qualifier rides in the head rather than on a line of its own: it says which
          numbers these are, which is what a heading is for. A second grey line under the first
          is two labels for one thing. */}
      <Head
        title={title}
        icon="square-stack"
        right={<span className="truncate text-[11.5px] text-ink-3">{t("FlashcardStats", "Subtitle")}</span>}
      />

      {stats.state === "loading" ? (
        <div className="mt-2 flex-1">
          <WidgetLoading rows={2} />
        </div>
      ) : stats.state === "error" ? (
        <WidgetError onRetry={stats.retry} />
      ) : (
        <div className={cn("mt-3 flex min-h-0 flex-1", isNarrow ? "flex-col justify-center gap-3" : "items-start gap-6")}>
          {cells.map((cell) => (
            <div key={cell.key} className="min-w-0 flex-1">
              <Stat value={cell.value} scale={0.72} />
              <p className="mt-1 truncate text-[12px] text-ink-3">{t(cell.ns, cell.key)}</p>
            </div>
          ))}
        </div>
      )}
    </Body>
  )
}
