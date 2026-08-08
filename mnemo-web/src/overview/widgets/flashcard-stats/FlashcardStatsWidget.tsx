import { Fragment } from "react"

import { useT } from "@/i18n/useT"

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
export function FlashcardStatsWidget({ instance }: WidgetProps) {
  const t = useT()
  const stats = useFlashcardStats()

  const cells: Cell[] = [
    { value: stats.cardsToday, ns: "Overview", key: "PracticedToday" },
    { value: stats.minutesToday, ns: "FlashcardStats", key: "MinutesToday" },
    { value: stats.sessionsToday, ns: "FlashcardStats", key: "SessionsToday" },
    { value: stats.streak, ns: "Overview", key: "Streak" },
  ]

  const isNarrow = instance.size.columns <= 1

  return (
    <div className="flex h-full flex-col gap-2.5">
      <p className="text-caption text-text-tertiary">{t("FlashcardStats", "Subtitle")}</p>

      {stats.state === "loading" ? (
        <WidgetLoading rows={2} />
      ) : stats.state === "error" ? (
        <WidgetError onRetry={stats.retry} />
      ) : isNarrow ? (
        // The 1x2 tile stacks the same four cells and centers them, with the hairlines turned on
        // their side. Nothing about the cells themselves changes.
        <div className="flex min-h-0 flex-1 flex-col justify-center gap-2.5">
          {cells.map((cell, index) => (
            <Fragment key={cell.key}>
              {index > 0 ? <div className="h-px w-full bg-divider-subtle" /> : null}
              <StatCell cell={cell} t={t} />
            </Fragment>
          ))}
        </div>
      ) : (
        <div className="flex items-start">
          {cells.map((cell, index) => (
            <Fragment key={cell.key}>
              {index > 0 ? <div className="mx-[14px] my-0.5 w-px self-stretch bg-divider-subtle" /> : null}
              {/* Equal shares of the row whatever the numbers are, matching the four star columns:
                  a five-digit count must not steal width from the cell beside it. */}
              <div className="min-w-0 flex-1">
                <StatCell cell={cell} t={t} />
              </div>
            </Fragment>
          ))}
        </div>
      )}
    </div>
  )
}

function StatCell({ cell, t }: { cell: Cell; t: ReturnType<typeof useT> }) {
  return (
    <div className="min-w-0">
      {/* Accent only once the metric has been earned. Zero is a real value, and rendering it in the
          brand color would make an untouched day look like an achievement. */}
      <p
        className={`truncate text-heading-4 font-semibold ${cell.value !== 0 ? "text-brand" : "text-text-primary"}`}
      >
        {cell.value}
      </p>
      <p className="mt-0.5 truncate text-caption text-text-secondary">{t(cell.ns, cell.key)}</p>
    </div>
  )
}
