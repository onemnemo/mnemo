import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import type { TestGrade } from "../test"

/**
 * The self-check. "Got it" is the filled button because it is the answer a test hopes for; the
 * other two carry their own colour on the outline so a miss never looks like the default.
 */
const GRADES: { grade: TestGrade; key: string; hint: string; className: string }[] = [
  {
    grade: "missed",
    key: "TestGradeMissed",
    hint: "1",
    className: "border-[var(--accent)] text-brand hover:bg-[var(--accent-subtle-background)]",
  },
  {
    grade: "close",
    key: "TestGradeClose",
    hint: "2",
    className:
      "border-[var(--flashcard-state-learning)] text-[var(--flashcard-state-learning)] hover:bg-[var(--toast-icon-badge-warning)]",
  },
  {
    grade: "gotIt",
    key: "GradeGotIt",
    hint: "⏎",
    className:
      "border-[var(--flashcard-retention-high)] bg-[var(--flashcard-retention-high)] text-[var(--accent-button-text)] hover:brightness-105",
  },
]

export function TestGradeRow({ onGrade }: { onGrade: (grade: TestGrade) => void }) {
  const t = useT()

  return (
    <div className="flex items-center justify-center gap-3">
      {GRADES.map(({ grade, key, hint, className }) => (
        <button
          key={grade}
          type="button"
          onClick={() => onGrade(grade)}
          className={cn(
            "flex h-12 w-[150px] cursor-pointer flex-col items-center justify-center rounded-md border",
            className,
          )}
        >
          <span className="font-semibold text-body-small">{t("Flashcards", key)}</span>
          <span className="font-mono text-[10.5px] opacity-75">{hint}</span>
        </button>
      ))}
    </div>
  )
}
