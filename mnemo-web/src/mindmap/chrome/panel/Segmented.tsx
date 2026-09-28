import { useRef, type KeyboardEvent, type ReactNode } from "react"

import { cn } from "@/lib/utils"

const STEP: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }

export interface Segment<T> {
  value: T
  /** The accessible name. */
  label: string
  face: ReactNode
}

/**
 * A sunken track with a raised chip that slides to the picked segment. A value that matches no
 * segment shows no chip rather than pretending to be the nearest one.
 */
export function Segmented<T extends string | number>({
  label,
  segments,
  value,
  onPick,
  className,
  compact,
}: {
  label: string
  segments: readonly Segment<T>[]
  value: T
  onPick: (value: T) => void
  /** Extra classes for each segment's button. */
  className?: string
  /** A 26 px track with equal segments as wide as the longest face, for a switch in a menu row. */
  compact?: boolean
}) {
  const track = useRef<HTMLDivElement>(null)
  const at = segments.findIndex((segment) => segment.value === value)

  // Radio semantics: the arrows move the pick, and the focus goes with it.
  const onKeyDown = (event: KeyboardEvent) => {
    const step = STEP[event.key] ?? 0
    if (step === 0) {
      return
    }
    event.preventDefault()
    const next = at < 0 ? (step > 0 ? 0 : segments.length - 1) : (at + step + segments.length) % segments.length
    onPick(segments[next].value)
    track.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus()
  }

  return (
    <div
      ref={track}
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn(
        "relative grid bg-canvas-sunken p-0.5 shadow-[inset_0_0_0_1px_var(--line-soft)]",
        compact ? "h-[26px] rounded-lg" : "h-8 rounded-[10px]",
      )}
      style={{ gridTemplateColumns: `repeat(${segments.length}, ${compact ? "minmax(40px, 1fr)" : "minmax(0, 1fr)"})` }}
    >
      {at < 0 ? null : (
        <span
          aria-hidden
          className={cn(
            "absolute top-0.5 bg-surface-float shadow-raised",
            compact ? "h-[22px] rounded-md" : "h-7 rounded-lg",
          )}
          style={{
            width: `calc((100% - 4px) / ${segments.length})`,
            left: `calc(2px + (100% - 4px) / ${segments.length} * ${at})`,
            transition: "left var(--duration-segment) var(--ease-segment)",
          }}
        />
      )}
      {segments.map((segment, index) => {
        const on = segment.value === value
        return (
          <button
            key={String(segment.value)}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={segment.label}
            tabIndex={on || (at < 0 && index === 0) ? 0 : -1}
            onClick={() => onPick(segment.value)}
            className={cn(
              "relative z-[1] flex items-center justify-center outline-none",
              compact ? "rounded-md px-2 whitespace-nowrap" : "rounded-lg",
              "transition-colors duration-(--duration-press) ease-[ease] focus-visible:ring-2 focus-visible:ring-accent",
              on ? "text-ink" : "text-ink-3 hover:text-ink-2",
              className,
            )}
          >
            {segment.face}
          </button>
        )
      })}
    </div>
  )
}
