import { Switch } from "radix-ui"

import { cn } from "@/lib/utils"

/** The switch every boolean settings row renders. */
export function ToggleControl({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  /** Accessible name, since the visible label lives in the row shell. */
  label: string
}) {
  return (
    <Switch.Root
      checked={checked}
      onCheckedChange={onChange}
      disabled={disabled}
      aria-label={label}
      className={cn(
        "relative h-[22px] w-[38px] rounded-pill border transition-colors outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring",
        checked ? "border-brand bg-brand" : "border-input bg-[var(--text-control-background)]",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <Switch.Thumb
        className={cn(
          "block h-4 w-4 rounded-full bg-white shadow-elevation-1 transition-transform",
          "translate-x-[3px] will-change-transform data-[state=checked]:translate-x-[18px]",
          !checked && "bg-text-faded",
        )}
      />
    </Switch.Root>
  )
}
