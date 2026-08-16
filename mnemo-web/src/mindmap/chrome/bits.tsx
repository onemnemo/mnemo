/**
 * The pieces every floating bar over the canvas is built from.
 *
 * One primitive per shape, shared rather than restyled per bar, because the dock and the selection
 * bars are the same object seen twice: a row of uniform square controls on a panel that hovers over
 * the map. Two implementations of that would drift within a week.
 */

import type { ReactNode } from "react"

import { Tooltip } from "@/components/ui/tooltip"
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
  /** The key that does the same thing, drawn on a cap beside the label. */
  chord?: string | null
  /** Filled accent rather than a tint: which tool is armed has to be readable at a glance. */
  active?: boolean
  /**
   * That this control has a panel of its own behind it, and whether that panel is open now.
   *
   * A control that opens one has to say so before it is pressed. The dock's two picker tools used to
   * look exactly like the four that plant one thing, so the only way to learn that a shape tool had
   * eight shapes behind it was to be told.
   */
  menu?: { open: boolean }
  disabled?: boolean
  onClick?: () => void
  /** For a readout rather than a glyph, which needs room for three digits and a sign. */
  wide?: boolean
}

/** One control. Every control on a floating bar is one of these, at one size. */
export function Slot({
  children,
  label,
  chord,
  active,
  menu,
  disabled,
  onClick,
  wide,
}: SlotProps) {
  return (
    <Tooltip label={label} chord={chord}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        aria-haspopup={menu ? "menu" : undefined}
        aria-expanded={menu ? menu.open : undefined}
        disabled={disabled}
        onClick={onClick}
        className={cn(
          "grid h-7 shrink-0 place-items-center rounded-[7px] transition-colors duration-120",
          wide ? "min-w-[46px] px-1.5 text-[11.5px] font-medium tabular-nums" : "w-7",
          menu && "relative",
          disabled && "pointer-events-none opacity-35",
          active ? "bg-accent text-accent-fg" : "text-ink-2 hover:bg-frame-hover hover:text-ink",
        )}
      >
        {children}
        {menu ? <MenuMark /> : null}
      </button>
    </Tooltip>
  )
}

/**
 * The sign that a control has more behind it.
 *
 * A folded corner rather than a chevron beside the glyph, because a slot is a square the width of its
 * icon: a chevron would either shrink the icon or widen the control out of the row it has to line up
 * in. It takes its colour from the text, so it reads on the armed tool's accent as well as off it.
 */
function MenuMark() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute right-[3.5px] bottom-[3.5px] size-[4px] opacity-60"
      style={{ backgroundColor: "currentColor", clipPath: "polygon(100% 0, 100% 100%, 0 100%)" }}
    />
  )
}

/** A hairline between groups of controls, which is all that separates them. */
export function Sep() {
  return <span className="mx-1 h-5 w-px shrink-0 bg-line" aria-hidden />
}
