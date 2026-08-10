import { Checkbox as RadixCheckbox } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * The app's checkbox: a 15px box that fills near-black when it is on.
 *
 * Deliberately not brand-coloured. A list of forty rows with a tick in each would
 * spend the accent forty times over, and the accent is what the app uses to say
 * "this is Mnemo" and "this is owed".
 *
 * `onToggle` fires with no argument on purpose. An indeterminate box would report
 * its next value as `true` either way, and callers here need to decide from the
 * current state instead.
 */
export function Checkbox({
  checked,
  onToggle,
  label,
  className,
}: {
  checked: boolean | "indeterminate"
  onToggle: () => void
  label: string
  className?: string
}) {
  return (
    <RadixCheckbox.Root
      checked={checked}
      onCheckedChange={onToggle}
      aria-label={label}
      onClick={(event) => event.stopPropagation()}
      className={cn(
        "grid size-[15px] shrink-0 place-items-center rounded-[4px] transition-colors outline-none",
        "focus-visible:ring-2 focus-visible:ring-accent/40",
        // A ring rather than a border: a 1.5px border on a 15px box eats the fill
        // it is meant to frame, and the box would jump by a pixel when it fills.
        checked === false
          ? "shadow-[0_0_0_1.5px_var(--line)] hover:shadow-[0_0_0_1.5px_var(--ink-3)]"
          : "bg-solid text-solid-fg",
        className,
      )}
      style={{ transitionDuration: "var(--duration-instant)" }}
    >
      <RadixCheckbox.Indicator className="grid place-items-center">
        {checked === "indeterminate" ? (
          <span className="h-[1.5px] w-[7px] rounded-full bg-current" />
        ) : (
          <svg viewBox="0 0 10 8" className="w-[9px] fill-none stroke-current" strokeWidth={2} aria-hidden>
            <path d="M1 4l2.5 2.5L9 1" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </RadixCheckbox.Indicator>
    </RadixCheckbox.Root>
  )
}
