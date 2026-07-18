import { Checkbox as RadixCheckbox } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * The app's checkbox, ported from the desktop theme: a 19px box with a 1.5px
 * border and the same hand-drawn tick geometry. Supports the indeterminate state
 * the card table's select-all header needs.
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
        "grid size-[19px] shrink-0 place-items-center rounded-[6px] border-[1.5px] transition-colors outline-none",
        "focus-visible:ring-2 focus-visible:ring-brand/40",
        checked === false
          ? "border-text-faded bg-transparent hover:border-text-secondary"
          : "border-brand bg-brand text-white",
        className,
      )}
    >
      <RadixCheckbox.Indicator className="grid place-items-center">
        {checked === "indeterminate" ? (
          <span className="h-[1.8px] w-[9px] rounded-full bg-current" />
        ) : (
          <svg viewBox="0 0 11 9" className="h-[8px] w-[10px]" fill="none" aria-hidden>
            <path
              d="M1 4.5 4 7.5 10 1.5"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </RadixCheckbox.Indicator>
    </RadixCheckbox.Root>
  )
}
