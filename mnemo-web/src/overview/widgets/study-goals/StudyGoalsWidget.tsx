import { useT } from "@/i18n/useT"

import { Body, Head, useWidgetTitle } from "../../parts"
import type { WidgetProps } from "../registry"
import { WidgetError, WidgetLoading } from "../states"
import { useStudyGoals } from "./useStudyGoals"

/**
 * Progress bars for the practice targets, one row per metric.
 *
 * The same three rows at every supported size. There is nothing here a wider tile would show more
 * of, so the layout does not read the span.
 */
export function StudyGoalsWidget({ instance, manifest }: WidgetProps) {
  const t = useT()
  const title = useWidgetTitle(manifest)
  const goals = useStudyGoals(instance, manifest)

  return (
    <Body>
      <Head title={title} icon="circle-check" />

      {goals.state === "loading" ? (
        <div className="mt-2 flex-1">
          <WidgetLoading rows={3} />
        </div>
      ) : goals.state === "error" ? (
        <WidgetError onRetry={goals.retry} />
      ) : (
        <div className="mt-3 flex flex-col gap-2.5">
          {goals.goals.map((goal) => (
            <div key={goal.titleKey} className="flex flex-col gap-1.5">
              <div className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{t("StudyGoals", goal.titleKey)}</span>
                <span className="shrink-0 text-[11.5px] tabular-nums text-ink-3">
                  {goal.completed}/{goal.target}
                </span>
              </div>

              {/* The fill keeps its own radius rather than relying on the track clipping it, so a
                  bar a few pixels along reads as a rounded stub instead of a sliver with square
                  ends. */}
              <div className="h-1.5 overflow-hidden rounded-full bg-canvas-sunken">
                <div className="h-full rounded-full bg-ink" style={{ width: `${goal.percent}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </Body>
  )
}
