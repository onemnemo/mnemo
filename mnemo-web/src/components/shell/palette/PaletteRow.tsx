import { AppIcon } from "@/components/icon/AppIcon"
import { cn } from "@/lib/utils"
import { splitMatch } from "@/search/score"
import type { Hit } from "@/search/types"

interface PaletteRowProps {
  hit: Hit
  query: string
  active: boolean
  index: number
  onHover: (index: number) => void
  onPick: (index: number) => void
}

export function PaletteRow({ hit, query, active, index, onHover, onPick }: PaletteRowProps) {
  const [before, matched, after] = splitMatch(hit.title, query)

  return (
    <button
      type="button"
      data-active={active}
      onPointerEnter={() => onHover(index)}
      onClick={() => onPick(index)}
      className={cn(
        "flex h-11 w-full items-center gap-3 rounded-lg px-2.5 text-left transition-colors",
        active && "bg-frame-hover",
      )}
      style={{ transitionDuration: "var(--duration-fast)" }}
    >
      <span className="grid size-6 shrink-0 place-items-center">
        {hit.icon && <AppIcon name={hit.icon} size={16} strokeWidth={1.6} className="text-ink-icon" />}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] tracking-[-0.006em] text-ink">
          {before}
          {/* Weight, not colour. A wash behind every match turns the list into a
              colour field, and spends the accent on the one thing already obvious. */}
          <span className="font-semibold">{matched}</span>
          {after}
        </span>
        {hit.context && <span className="block truncate text-[12px] leading-[15px] text-ink-3">{hit.context}</span>}
      </span>

      {active && <AppIcon name="corner-down-left" size={14} strokeWidth={1.8} className="shrink-0 text-ink-3" />}
    </button>
  )
}
