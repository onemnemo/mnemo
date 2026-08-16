import { useI18nStore } from "@/i18n/store"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import { HISTORY_DAYS, useDailyActivity } from "../../data/useDailyActivity"
import { Body, Head, Stat, useWidgetTitle } from "../../parts"
import type { WidgetProps } from "../registry"
import { WidgetError, WidgetLoading } from "../states"
import { summarizeStreak } from "./streak"

const NS = "WidgetStreak"

/** Narrow weekday initial for a UTC day key, in the reader's own language. */
function weekdayInitial(dayKey: string, locale: string): string {
  return new Date(`${dayKey}T00:00:00Z`).toLocaleDateString(locale, { weekday: "narrow", timeZone: "UTC" })
}

/**
 * The streak, with the week beside it as seven dots.
 *
 * Both the run and the dots are derived from the same day series the heatmap reads rather than
 * from the lifetime totals record, which only moves when a session is written: a stored streak
 * counter has no way to notice a day nobody studied, so it keeps reporting the run that was true
 * the last time the user practised.
 */
export function StreakWidget({ manifest, renderColumns }: WidgetProps) {
  const t = useT()
  const locale = useI18nStore((state) => state.language)
  const title = useWidgetTitle(manifest)
  const activity = useDailyActivity(HISTORY_DAYS)

  if (activity.state !== "ready") {
    return (
      <Body>
        <Head title={title} icon="flame" />
        {activity.state === "loading" ? (
          <div className="mt-2 flex-1">
            <WidgetLoading rows={2} />
          </div>
        ) : (
          <WidgetError onRetry={activity.retry} />
        )}
      </Body>
    )
  }

  const streak = summarizeStreak(activity.days)
  const week = activity.days.slice(-7)

  const dots = (
    <div className="flex shrink-0 items-end gap-1.5">
      {week.map((day, index) => (
        <div key={day.day} className="flex flex-col items-center gap-1">
          <span
            title={t(NS, "ReviewsOnDay", { 0: day.reviews, 1: day.day })}
            className={cn(
              "size-[7px] rounded-full",
              day.reviews > 0 ? "bg-ink-2" : "bg-canvas-sunken",
              // Today is the only one that needs an outline: it is the day still open to change.
              index === week.length - 1 && "ring-2 ring-ink-3/30 ring-offset-1 ring-offset-canvas",
            )}
          />
          {renderColumns >= 2 && (
            <span className="text-[9.5px] leading-none text-ink-3">{weekdayInitial(day.day, locale)}</span>
          )}
        </div>
      ))}
    </div>
  )

  return (
    <Body>
      <Head title={title} icon="flame" />
      {renderColumns >= 2 ? (
        <div className="flex flex-1 items-center gap-5">
          <div className="shrink-0">
            <Stat value={streak.current} unit={t(NS, "Days")} />
            {/* Only worth saying when it is something to beat. "Best 21" under a current streak of
                21 is a fact about nothing. */}
            {streak.best > streak.current && (
              <p className="mt-1 text-[12px] text-ink-3">{t(NS, "BestFormat", { 0: streak.best })}</p>
            )}
          </div>
          <div className="ml-auto">{dots}</div>
        </div>
      ) : (
        <>
          <div className="mt-auto">
            <Stat value={streak.current} unit={t(NS, "Days")} scale={0.85} />
          </div>
          <div className="mt-2.5">{dots}</div>
        </>
      )}
    </Body>
  )
}
