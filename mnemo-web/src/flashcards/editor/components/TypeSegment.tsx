import type { CardType } from "@/api/types"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

/** The Classic | Cloze switch in the editor header. */
export function TypeSegment({ value, onChange }: { value: CardType; onChange: (next: CardType) => void }) {
  const t = useT()

  return (
    <div className="flex h-8 items-center gap-0.5 rounded-lg bg-canvas-sunken p-0.5">
      {(["classic", "cloze"] as const).map((type) => {
        const on = value === type
        return (
          <button
            key={type}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(type)}
            className={cn(
              "h-7 rounded-[6px] px-2.5 text-[12.5px] font-medium transition-colors",
              on ? "bg-canvas text-ink shadow-[0_1px_2px_oklch(0_0_0/0.07)]" : "text-ink-3 hover:text-ink-2",
            )}
          >
            {t("Flashcards", type === "cloze" ? "TypeCloze" : "TypeClassic")}
          </button>
        )
      })}
    </div>
  )
}
