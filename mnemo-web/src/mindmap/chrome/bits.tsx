/**
 * The pieces every floating bar over the canvas is built from.
 *
 * One primitive per shape, shared rather than restyled per bar, because the dock and the selection
 * bars are the same object seen twice: a row of uniform square controls on a panel that hovers over
 * the map. Two implementations of that would drift within a week.
 */

import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

/**
 * A panel that floats over the map.
 *
 * It swallows its own pointer presses. The canvas underneath treats a press on empty space as the
 * start of a marquee, and a bar that let one through would clear the selection the bar is about.
 */
export function FloatBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "pointer-events-auto flex h-10 items-center gap-0.5 rounded-xl bg-canvas px-1.5 shadow-pop animate-pop-in",
        className,
      )}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  )
}

export interface SlotProps {
  children: ReactNode
  /** The accessible name, and what the tooltip says. */
  label: string
  /** Filled accent rather than a tint: which tool is armed has to be readable at a glance. */
  active?: boolean
  disabled?: boolean
  onClick?: () => void
  onPointerDown?: (event: React.PointerEvent<HTMLButtonElement>) => void
  onPointerUp?: (event: React.PointerEvent<HTMLButtonElement>) => void
  onPointerLeave?: (event: React.PointerEvent<HTMLButtonElement>) => void
  onPointerCancel?: (event: React.PointerEvent<HTMLButtonElement>) => void
  /** For a readout rather than a glyph, which needs room for three digits and a sign. */
  wide?: boolean
}

/** One control. Every control on a floating bar is one of these, at one size. */
export function Slot({
  children,
  label,
  active,
  disabled,
  onClick,
  onPointerDown,
  onPointerUp,
  onPointerLeave,
  onPointerCancel,
  wide,
}: SlotProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerLeave}
      onPointerCancel={onPointerCancel}
      className={cn(
        "grid h-7 shrink-0 place-items-center rounded-[7px] transition-colors duration-120",
        wide ? "min-w-[46px] px-1.5 text-[11.5px] font-medium tabular-nums" : "w-7",
        disabled && "pointer-events-none opacity-35",
        active ? "bg-accent text-accent-fg" : "text-ink-2 hover:bg-frame-hover hover:text-ink",
      )}
    >
      {children}
    </button>
  )
}

/** A hairline between groups of controls, which is all that separates them. */
export function Sep() {
  return <span className="mx-1 h-5 w-px shrink-0 bg-line" aria-hidden />
}
