import { Select } from "radix-ui"

import { AppIcon } from "@/components/icon/AppIcon"
import { cn } from "@/lib/utils"

export interface SelectChoice {
  value: string
  label: string
}

/**
 * The dropdown shared by option rows, model pickers and the language switch.
 *
 * A custom popup rather than a native select: the desktop uses one too, and a native
 * control would render the host OS's own list inside a themed app.
 */
export function SelectControl({
  value,
  choices,
  onChange,
  disabled,
  label,
  placeholder,
  className,
}: {
  value: string
  choices: SelectChoice[]
  onChange: (next: string) => void
  disabled?: boolean
  /** Accessible name, since the visible label lives in the row shell. */
  label: string
  placeholder?: string
  className?: string
}) {
  return (
    <Select.Root value={value || undefined} onValueChange={onChange} disabled={disabled}>
      <Select.Trigger
        aria-label={label}
        className={cn(
          "flex h-[30px] min-w-[130px] items-center justify-between gap-2 rounded-sm border border-input",
          "bg-[var(--text-control-background)] px-2.5 text-body-small text-text-primary outline-none",
          "hover:border-[var(--text-control-border-pointer-over)]",
          "focus-visible:border-[var(--text-control-border-focused)]",
          "disabled:cursor-not-allowed disabled:opacity-60",
          className,
        )}
      >
        <Select.Value placeholder={placeholder} />
        <Select.Icon>
          <AppIcon name="common/chevron-down" size={14} />
        </Select.Icon>
      </Select.Trigger>

      <Select.Portal>
        <Select.Content
          position="popper"
          sideOffset={4}
          className="z-50 max-h-72 overflow-hidden rounded-md border bg-popover shadow-elevation-3"
        >
          <Select.Viewport className="p-1">
            {choices.map((choice) => (
              <Select.Item
                key={choice.value}
                value={choice.value}
                className={cn(
                  "flex cursor-default select-none items-center justify-between gap-3 rounded-sm px-2 py-1.5",
                  "text-body-small text-text-primary outline-none",
                  "data-[highlighted]:bg-frame-hover data-[state=checked]:font-medium",
                )}
              >
                <Select.ItemText>{choice.label}</Select.ItemText>
                <Select.ItemIndicator>
                  <AppIcon name="common/check" size={13} />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  )
}
