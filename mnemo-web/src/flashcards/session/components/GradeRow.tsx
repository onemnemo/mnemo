import type { ReviewGrade, StudyIntervalsDto } from "@/api/types"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

/**
 * Good is the filled button because it is the answer most reviews get; the other three stay
 * outlined and only show their colour on hover, so the row does not read as four equal choices.
 */
const GRADES: { grade: ReviewGrade; key: string; hover: string }[] = [
  { grade: "again", key: "GradeAgain", hover: "hover:border-[var(--accent)]" },
  { grade: "hard", key: "GradeHard", hover: "hover:border-[var(--flashcard-state-learning)]" },
  { grade: "good", key: "GradeGood", hover: "" },
  { grade: "easy", key: "GradeEasy", hover: "hover:border-[var(--flashcard-retention-high)]" },
]

export function GradeRow({
  intervals,
  disabled,
  onGrade,
}: {
  intervals: StudyIntervalsDto | null
  disabled: boolean
  onGrade: (grade: ReviewGrade) => void
}) {
  const t = useT()

  return (
    <div className="flex items-center justify-center gap-3">
      {GRADES.map(({ grade, key, hover }) => {
        const good = grade === "good"
        return (
          <button
            key={grade}
            type="button"
            disabled={disabled}
            onClick={() => onGrade(grade)}
            className={cn(
              "flex h-[52px] w-[132px] cursor-pointer flex-col items-center justify-center rounded-md border",
              "disabled:pointer-events-none disabled:opacity-50",
              good
                ? "border-[var(--accent)] bg-brand text-[var(--accent-button-text)]"
                : cn("border-line bg-transparent", hover),
            )}
          >
            <span className="font-semibold text-body-small">{t("Flashcards", key)}</span>
            <span className="font-mono text-[10.5px] opacity-75">{intervals?.[grade] ?? ""}</span>
          </button>
        )
      })}
    </div>
  )
}
