import { useI18nStore } from "@/i18n/store"
import { useT } from "@/i18n/useT"
import { useReviewForecastQuery } from "@/flashcards/api"

import { settingInt } from "../../config/encode"
import { Bars, Body, Head, useWidgetTitle } from "../../parts"
import type { WidgetProps } from "../registry"
import { WidgetError, WidgetLoading } from "../states"

const NS = "WidgetForecast"

/** A short window gets weekday initials; a long one gets day-of-month numbers. */
function columnLabel(dayKey: string, locale: string, short: boolean): string {
  const date = new Date(`${dayKey}T00:00:00Z`)
  return short
    ? date.toLocaleDateString(locale, { weekday: "narrow", timeZone: "UTC" })
    : String(date.getUTCDate())
}

/** One label every nth column: thirty labels is noise, seven is a week. */
function labelEveryFor(days: number): number {
  if (days <= 7) return 1
  return days <= 14 ? 2 : 5
}

/**
 * The coming days as stacked columns.
 *
 * Monochrome, like the heatmap. A thirty-column chart painted in the due colour is thirty bars of
 * brand orange, and at that size the accent stops being an accent. The card states earn their
 * colour where they carry a decision, the mix bar you read before pressing Study, not in a chart
 * you glance at.
 */
export function ForecastWidget({ instance, manifest }: WidgetProps) {
  const t = useT()
  const locale = useI18nStore((state) => state.language)
  const title = useWidgetTitle(manifest)

  const days = settingInt(manifest, instance.settings, "days")
  const forecast = useReviewForecastQuery(days)

  const points = forecast.data ?? []
  const total = points.reduce((sum, point) => sum + point.due + point.new, 0)
  const short = days <= 7

  return (
    <Body>
      <Head
        title={title}
        icon="calendar-clock"
        right={
          forecast.isSuccess ? (
            <span className="text-[11.5px] tabular-nums text-ink-3">
              {t(NS, "TotalInWindow", { 0: total.toLocaleString(locale), 1: days })}
            </span>
          ) : undefined
        }
      />

      {forecast.isPending ? (
        <div className="mt-2 flex-1">
          <WidgetLoading rows={3} />
        </div>
      ) : forecast.isError ? (
        <WidgetError onRetry={() => void forecast.refetch()} />
      ) : (
        <Bars
          className="mt-2.5"
          labelEvery={labelEveryFor(days)}
          bars={points.map((point) => ({
            key: point.day,
            label: columnLabel(point.day, locale, short),
            parts: [
              { value: point.due, className: "bg-ink-2" },
              { value: point.new, className: "bg-ink-3/40" },
            ],
          }))}
        />
      )}
    </Body>
  )
}
