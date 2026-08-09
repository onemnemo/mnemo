import { useI18nStore } from "@/i18n/store"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import { Body, Head, useWidgetTitle } from "../../parts"
import type { WidgetProps } from "../registry"
import { WidgetError, WidgetLoading } from "../states"
import { formatCount, formatDuration } from "./format"
import { useUsageSummary } from "./useUsageSummary"

const NS = "UsageSummary"

/**
 * Six label and value rows: one headline, two lifetime counters, three per-area timers.
 *
 * The same six rows at every supported size, as on the desktop. Only the headline is accented,
 * which is what marks it as the row the widget is configured around.
 */
export function UsageSummaryWidget({ instance, manifest }: WidgetProps) {
  const t = useT()
  const title = useWidgetTitle(manifest)
  const locale = useI18nStore((state) => state.language)
  const usage = useUsageSummary(instance, manifest)

  if (usage.state === "loading") {
    return (
      <Body>
        <Head title={title} icon="layers" />
        <div className="mt-2 flex-1">
          <WidgetLoading rows={6} />
        </div>
      </Body>
    )
  }
  if (usage.state === "error") {
    return (
      <Body>
        <Head title={title} icon="layers" />
        <WidgetError onRetry={usage.retry} />
      </Body>
    )
  }

  // Only the four period-scoped labels carry the day count. Saying "lifetime launches, last 7
  // days" would describe a number that is neither.
  const scoped = (key: string) => t(NS, "LabelWithPeriod", { 0: t(NS, key), 1: usage.periodDays })
  const duration = (seconds: number) => formatDuration(seconds, t)

  const rows = [
    {
      id: "metric",
      label: scoped(usage.reviewMetric ? "CardsReviewedMetric" : "TimeSpentMetric"),
      value: usage.reviewMetric
        ? formatCount(usage.cardsReviewed, locale)
        : duration(usage.practiceSeconds + usage.notesEditorSeconds + usage.flashcardsSeconds),
      headline: true,
    },
    { id: "launches", label: t(NS, "Launches"), value: formatCount(usage.launches, locale), headline: false },
    { id: "notes", label: t(NS, "NotesCreated"), value: formatCount(usage.notesCreated, locale), headline: false },
    { id: "practice", label: scoped("Practice"), value: duration(usage.practiceSeconds), headline: false },
    { id: "editor", label: scoped("NotesEditor"), value: duration(usage.notesEditorSeconds), headline: false },
    { id: "flashcards", label: scoped("FlashcardsArea"), value: duration(usage.flashcardsSeconds), headline: false },
  ]

  return (
    <Body>
      <Head title={title} icon="layers" />
      <div className="mt-3 flex flex-col gap-2.5">
        {rows.map((row) => (
          <div key={row.id} className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-[12px] text-ink-2">{row.label}</span>
            <span className={cn("shrink-0 text-[12.5px] tabular-nums", row.headline ? "font-semibold text-ink" : "text-ink-2")}>
              {row.value}
            </span>
          </div>
        ))}
      </div>
    </Body>
  )
}
