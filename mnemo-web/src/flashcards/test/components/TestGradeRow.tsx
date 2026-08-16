import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import type { TestGrade } from "../test"

/**
 * The self-check, marked wide and central rather than as a grid: this is a judgement about the
 * one answer just written, not a dial being set. Got it is filled in the correct-green; a miss
 * is outlined in danger so it never reads as the default; close stays plain in between.
 */
const GRADES: { grade: TestGrade; key: string; hint: string; tone: "missed" | "close" | "got" }[] = [
  { grade: "missed", key: "TestGradeMissed", hint: "1", tone: "missed" },
  { grade: "close", key: "TestGradeClose", hint: "2", tone: "close" },
  { grade: "gotIt", key: "GradeGotIt", hint: "⏎", tone: "got" },
]

export function TestGradeRow({ onGrade }: { onGrade: (grade: TestGrade) => void }) {
  const t = useT()

  return (
    <div className="mx-auto flex w-full max-w-[520px] items-stretch gap-3">
      {GRADES.map(({ grade, key, hint, tone }) => {
        const got = tone === "got"
        return (
          <button
            key={grade}
            type="button"
            onClick={() => onGrade(grade)}
            className={cn(
              "flex h-12 flex-1 cursor-pointer flex-col items-center justify-center rounded-xl transition-colors",
              tone === "missed" && "text-danger shadow-[0_0_0_1px_var(--danger)] hover:bg-danger-wash",
              tone === "close" && "text-ink shadow-[0_0_0_1px_var(--line)] hover:bg-frame-hover",
              got && "bg-ok text-ok-fg hover:bg-ok-hover",
            )}
          >
            <span className="text-[13.5px] font-medium">{t("Flashcards", key)}</span>
            <span className={cn("text-[11px]", got ? "text-ok-fg/70" : "text-ink-3")}>{hint}</span>
          </button>
        )
      })}
    </div>
  )
}
