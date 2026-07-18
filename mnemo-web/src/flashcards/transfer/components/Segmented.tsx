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

export interface SegmentOption<T extends string> {
  value: T
  label: string
  icon?: IconName
  /** A figure alongside the label, e.g. how many decks a scope covers. */
  count?: number
  disabled?: boolean
}

/**
 * The desktop's segmented track: equal-width options in a recessed rail, the chosen one lifted
 * onto the surface. Used for the import/export direction and the conflict policy, which are both
 * short exclusive choices that deserve to be visible rather than folded into a dropdown.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T
  options: readonly SegmentOption<T>[]
  onChange: (value: T) => void
  label: string
  className?: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("grid gap-1 rounded-lg border border-line bg-surface-subtle p-1", className)}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option, index) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={option.disabled}
            // A radiogroup is one tab stop whose members are reached with the arrow keys. Without
            // the roving index and the handler below, the role would promise a way of moving
            // between these that does not exist.
            tabIndex={selected ? 0 : -1}
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
              "flex h-7 min-w-0 items-center justify-center gap-1.5 rounded-md px-2 text-body-extra-small transition-colors",
              "disabled:pointer-events-none disabled:opacity-40",
              selected
                ? "bg-surface font-semibold text-text-primary shadow-elevation-1"
                : "text-text-tertiary hover:text-text-secondary",
            )}
          >
            {option.icon ? <AppIcon name={option.icon} size={13} /> : null}
            <span className="truncate">{option.label}</span>
            {option.count === undefined ? null : (
              <span className="shrink-0 font-mono text-caption text-text-faded">{option.count}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
