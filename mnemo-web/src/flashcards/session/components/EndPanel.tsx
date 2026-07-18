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
    <div className="m-auto flex max-w-[420px] flex-col items-center gap-4 text-center">
      <AppIcon
        name="common/check-circle"
        size={52}
        className={caughtUp ? "text-[var(--flashcard-retention-high)]" : "text-brand"}
      />
      <h2 className="font-semibold text-heading-3">{fc(caughtUp ? "StudyAllCaughtUpTitle" : "StudyCompleteTitle")}</h2>
      <p className="text-text-secondary">
        {caughtUp ? fc("StudyAllCaughtUpDesc") : fc("StudyCompleteSummaryFormat", { 0: completed })}
      </p>
      <Button onClick={onBackToDeck}>{fc("BackToDeck")}</Button>
    </div>
  )
}
