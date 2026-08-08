import { useT } from "@/i18n/useT"

import type { WidgetProps } from "../registry"
import { WidgetError, WidgetLoading } from "../states"
import { useStudyGoals } from "./useStudyGoals"

/**
 * Progress bars for the practice targets, one row per metric.
 *
 * The same three rows at every supported size. The desktop's view reads neither the span nor the
 * narrow flag, and there is nothing here that a wider tile would show more of.
 */
export function StudyGoalsWidget({ instance, manifest }: WidgetProps) {
  const t = useT()
  const goals = useStudyGoals(instance, manifest)

  if (goals.state === "loading") return <WidgetLoading rows={3} />
  if (goals.state === "error") return <WidgetError onRetry={goals.retry} />

  return (
    <div className="flex flex-col gap-2">
      {goals.goals.map((goal) => (
        <div key={goal.titleKey} className="flex flex-col gap-1">
          <div className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-text-primary">
              {t("StudyGoals", goal.titleKey)}
            </span>
            <span className="shrink-0 text-body-extra-small text-text-secondary">
              {goal.completed}/{goal.target}
            </span>
          </div>

          {/* The fill keeps its own radius rather than relying on the track clipping it, so a bar
              a few pixels along reads as a rounded stub instead of a sliver with square ends. */}
          <div className="h-1.5 overflow-hidden rounded-[3px] bg-sidebar-border">
            <div className="h-full rounded-[3px] bg-brand" style={{ width: `${goal.percent}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}
