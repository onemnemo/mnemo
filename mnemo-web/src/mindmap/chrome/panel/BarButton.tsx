import type { ReactNode } from "react"

import { Tooltip } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

export interface BarButtonProps {
  label: string
  /** The panel this button opens, and whether that panel is open now. */
  opens?: { key: string; open: boolean }
  disabled?: boolean
  /** Keep a disabled button at full strength, for one that still reads as a status. */
  undimmed?: boolean
  onClick: () => void
  /** For a button that shows its own words, which then need no tooltip. */
  labelled?: boolean
  className?: string
  children: ReactNode
}

/** One control on a selection bar: 32 px tall, pressed while its panel is open. */
export function BarButton({ label, opens, disabled, undimmed, onClick, labelled, className, children }: BarButtonProps) {
  return (
    <Tooltip label={labelled ? "" : label}>
      <button
        type="button"
        aria-label={label}
        aria-haspopup={opens ? "dialog" : undefined}
        aria-expanded={opens ? opens.open : undefined}
        data-panel-opener={opens?.key}
        disabled={disabled}
        onClick={onClick}
        className={cn(
          "flex h-8 shrink-0 items-center rounded-[9px] outline-none",
          "transition-colors duration-(--duration-press) ease-[ease]",
          "focus-visible:ring-2 focus-visible:ring-accent",
          disabled && "pointer-events-none",
          disabled && !undimmed && "opacity-45",
          opens?.open ? "bg-frame-active text-ink" : "text-ink-2 hover:bg-frame-hover hover:text-ink",
          className,
        )}
      >
        {children}
      </button>
    </Tooltip>
  )
}

/** A hairline between groups on a bar. */
export function BarDivider() {
  return <span aria-hidden className="mx-1 h-[18px] w-px shrink-0 bg-line" />
}

/** A 16 px dot in the colour actually drawn, in a gap ring that is the button's own background. */
export function SwatchFace({ color, pressed }: { color: string; pressed: boolean }) {
  const gap = pressed ? "var(--frame-active)" : "var(--surface-float)"
  return (
    <span
      aria-hidden
      className="size-4 rounded-full transition-shadow duration-(--duration-press)"
      style={{ background: color, boxShadow: `0 0 0 2px ${gap}, 0 0 0 3.5px ${color}` }}
    />
  )
}
