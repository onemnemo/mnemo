import type { CardType } from "@/api/types"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

const SEGMENT_CLASS =
  "h-[30px] w-[75px] rounded-sm text-caption text-text-secondary transition-colors hover:bg-white/55"

const SELECTED_CLASS =
  "bg-[var(--workspace-background)] font-medium text-text-primary shadow-[0_1px_3px_0_rgba(0,0,0,0.08)] hover:bg-[var(--workspace-background)]"

/** The Classic | Cloze switch in the editor header. */
export function TypeSegment({ value, onChange }: { value: CardType; onChange: (next: CardType) => void }) {
  const t = useT()

  return (
    <div className="flex rounded-md bg-[var(--card-background-secondary)] p-[3px]">
      {(["classic", "cloze"] as const).map((type) => (
        <button
          key={type}
          type="button"
          aria-pressed={value === type}
          onClick={() => onChange(type)}
          className={cn(SEGMENT_CLASS, value === type && SELECTED_CLASS)}
        >
          {t("Flashcards", type === "cloze" ? "TypeCloze" : "TypeClassic")}
        </button>
      ))}
    </div>
  )
}
