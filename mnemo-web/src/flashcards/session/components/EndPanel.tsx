import { AppIcon } from "@/components/icon/AppIcon"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/useT"

/**
 * The two screens a session can end on. "All caught up" is the review-only case where there was
 * nothing scheduled to begin with; everything else - including a cram with an empty scope -
 * finishes on the completion panel with its count.
 */
export function EndPanel({
  caughtUp,
  completed,
  onBackToDeck,
}: {
  caughtUp: boolean
  completed: number
  onBackToDeck: () => void
}) {
  const t = useT()
  const fc = (key: string, params?: Record<string, string | number>) => t("Flashcards", key, params)

  return (
    <div className="m-auto flex flex-col items-center px-6 pb-16 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-canvas-sunken">
        <AppIcon name={caughtUp ? "sparkles" : "check"} size={24} strokeWidth={2} className="text-ink" />
      </span>
      <h2 className="mt-4 text-[20px] font-semibold tracking-[-0.02em] text-ink">
        {fc(caughtUp ? "StudyAllCaughtUpTitle" : "StudyCompleteTitle")}
      </h2>
      <p className="mt-1 text-[13.5px] text-ink-2">
        {caughtUp ? fc("StudyAllCaughtUpDesc") : fc("StudyCompleteSummaryFormat", { 0: completed })}
      </p>
      <div className="mt-6">
        <Button onClick={onBackToDeck}>{fc("BackToDeck")}</Button>
      </div>
    </div>
  )
}
