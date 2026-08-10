import type { ReactNode } from "react"

import type { ReviewGrade, StudyIntervalsDto } from "@/api/types"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

/**
 * The four grades, each showing the interval it buys so grading is not a guess.
 *
 * Again is a mistake rather than a danger, so it is outlined in the danger colour, not filled
 * with it. Good is the filled button because it is the answer most reviews get; Hard and Easy
 * stay plain, so the row reads as one obvious choice with three alternatives, not four equals.
 */
const GRADES: { grade: ReviewGrade; key: string; tone: "again" | "good" | "plain" }[] = [
  { grade: "again", key: "GradeAgain", tone: "again" },
  { grade: "hard", key: "GradeHard", tone: "plain" },
  { grade: "good", key: "GradeGood", tone: "good" },
  { grade: "easy", key: "GradeEasy", tone: "plain" },
]

export function GradeRow({
  intervals,
  disabled,
  onGrade,
}: {
  intervals: StudyIntervalsDto | null
  disabled: boolean
  onGrade: (grade: ReviewGrade) => void
}): ReactNode {
  const t = useT()

  return (
    <div className="grid w-full grid-cols-4 gap-2">
      {GRADES.map(({ grade, key, tone }) => {
        const good = tone === "good"
        return (
          <button
            key={grade}
            type="button"
            disabled={disabled}
            onClick={() => onGrade(grade)}
            className={cn(
              "flex h-11 cursor-pointer flex-col items-center justify-center rounded-xl transition-colors",
              "disabled:pointer-events-none disabled:opacity-50",
              tone === "again" && "text-danger shadow-[0_0_0_1px_var(--danger)] hover:bg-danger-wash",
              good && "bg-solid text-solid-fg hover:bg-solid-hover",
              tone === "plain" && "text-ink shadow-[0_0_0_1px_var(--line)] hover:bg-frame-hover",
            )}
          >
            <span className="text-[13px] font-medium">{t("Flashcards", key)}</span>
            <span className={cn("text-[11px] tabular-nums", good ? "text-solid-fg/65" : "text-ink-3")}>
              {intervals?.[grade] ?? ""}
            </span>
          </button>
        )
      })}
    </div>
  )
}
