import { AppIcon } from "@/components/icon/AppIcon"
import type { IconName } from "@/components/icon/icon-registry"
import { cn } from "@/lib/utils"

/** Which way each arrow key moves through the group. Both axes, since the track is one row. */
const ARROW_STEPS: Record<string, number | undefined> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
}

export interface SegmentedOption<T extends string> {
  value: T
  label: string
  icon?: IconName
  disabled?: boolean
}

/**
 * A small set of exclusive choices, all of them visible: a recessed rail with the chosen option
 * lifted onto the surface.
 *
 * The line it holds against a dropdown: use this when there are two to four options, the labels
 * are short, and seeing the alternatives is part of making the choice. "Narrow / Normal / Wide"
 * is a scale, and a dropdown reading "Normal" hides the fact that it is the middle of one.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  mono,
  className,
}: {
  value: T
  options: readonly SegmentedOption<T>[]
  onChange: (next: T) => void
  /** Accessible name for the group, since the visible label usually lives in the row beside it. */
  label: string
  /** For extensions and the like, which read as filenames rather than words. */
  mono?: boolean
  className?: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("flex h-8 items-center gap-0.5 rounded-lg bg-canvas-sunken p-0.5", className)}
    >
      {options.map((option, index) => {
        const on = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={option.disabled}
            // A radiogroup is one tab stop whose members are reached with the arrow keys. Without
            // the roving index and the handler below, the role would promise a way of moving
            // between these that does not exist.
            tabIndex={on ? 0 : -1}
            onKeyDown={(event) => {
              const step = ARROW_STEPS[event.key]
              if (!step) return
              event.preventDefault()

              // Wraps, and steps over disabled options rather than stopping on one.
              const count = options.length
              for (let hop = 1; hop <= count; hop++) {
                const at = (((index + step * hop) % count) + count) % count
                if (options[at].disabled) continue
                onChange(options[at].value)
                // Focus follows the selection, which is the half of the arrow-key contract that
                // choosing a value alone does not satisfy.
                const buttons = event.currentTarget.parentElement?.querySelectorAll("button")
                buttons?.[at]?.focus()
                break
              }
            }}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex h-7 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[7px] px-2.5",
              "whitespace-nowrap transition-colors duration-120",
              "disabled:pointer-events-none disabled:opacity-40",
              mono ? "font-mono text-[11.5px]" : "text-[12.5px] font-medium",
              on ? "bg-canvas text-ink shadow-canvas" : "text-ink-3 hover:text-ink-2",
            )}
          >
            {option.icon ? <AppIcon name={option.icon} size={14} strokeWidth={1.8} /> : null}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
