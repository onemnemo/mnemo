import { useI18nStore } from "@/i18n/store"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import { HISTORY_DAYS, useDailyActivity } from "../../data/useDailyActivity"
import { Body, Head, useWidgetTitle } from "../../parts"
import type { WidgetProps } from "../registry"
import { WidgetError, WidgetLoading } from "../states"
import { Heatmap } from "./Heatmap"
import { LEVELS } from "./levels"

const NS = "WidgetActivity"

/** A year of study days, one square each. */
export function ActivityWidget({ instance, manifest }: WidgetProps) {
  const t = useT()
  const locale = useI18nStore((state) => state.language)
  const title = useWidgetTitle(manifest)
  const activity = useDailyActivity(HISTORY_DAYS)

  const rowSpan = instance.size.rows
  const total = activity.days.reduce((sum, day) => sum + day.reviews, 0)

  return (
    <Body>
      <Head
        title={title}
        icon="calendar-days"
        right={
          activity.state === "ready" ? (
            <span className="text-[11.5px] tabular-nums text-ink-3">
              {t(NS, "ReviewsTotal", { 0: total.toLocaleString(locale) })}
            </span>
          ) : undefined
        }
      />

      {activity.state === "loading" ? (
        <div className="mt-2 flex-1">
          <WidgetLoading rows={3} />
        </div>
      ) : activity.state === "error" ? (
        <WidgetError onRetry={activity.retry} />
      ) : (
        <>
          <Heatmap days={activity.days} rowSpan={rowSpan} />
          {rowSpan >= 2 && (
            <div className="mt-auto flex shrink-0 items-center gap-1.5 pt-3 text-[11px] text-ink-3">
              {t(NS, "Less")}
              {LEVELS.map((level, index) => (
                <span key={index} className={cn("size-[9px] rounded-[2px]", level)} />
              ))}
              {t(NS, "More")}
            </div>
          )}
        </>
      )}
    </Body>
  )
}
