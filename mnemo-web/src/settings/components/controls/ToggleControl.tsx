import { Switch } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * The switch every boolean settings row renders.
 *
 * The on state is `solid`, near-black in light and near-white in dark, and not the brand orange.
 * Same reasoning as the buttons: contrast carries the state, and if every switch in settings is
 * orange then the accent stops meaning Mnemo and starts meaning "on".
 */
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
        "relative h-[20px] w-[34px] shrink-0 rounded-full outline-none transition-colors",
        checked ? "bg-solid" : "bg-frame-active",
        disabled && "pointer-events-none opacity-40",
      )}
      style={{ transitionDuration: "var(--duration-normal)" }}
    >
      <Switch.Thumb
        className={cn(
          "block size-[14px] rounded-full bg-canvas shadow-sm transition-transform will-change-transform",
          "translate-x-[3px] data-[state=checked]:translate-x-[17px]",
        )}
        style={{ transitionDuration: "var(--duration-normal)" }}
      />
    </Switch.Root>
  )
}
