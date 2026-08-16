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
          "flex h-8 min-w-[130px] items-center justify-between gap-2 rounded-lg px-2.5",
          "text-[13px] text-ink outline-none shadow-[0_0_0_1px_var(--line)] transition-colors",
          "hover:bg-frame-hover disabled:pointer-events-none disabled:opacity-45",
          className,
        )}
        style={{ transitionDuration: "var(--duration-fast)" }}
      >
        <Select.Value placeholder={placeholder} />
        <Select.Icon>
          <AppIcon name="chevron-down" size={14} strokeWidth={1.8} className="text-ink-icon" />
        </Select.Icon>
      </Select.Trigger>

      <Select.Portal>
        <Select.Content
          position="popper"
          sideOffset={4}
          className="animate-pop-in z-[150] max-h-72 overflow-hidden rounded-xl bg-canvas p-0 shadow-pop"
        >
          <Select.Viewport className="p-1.5">
            {choices.map((choice) => (
              <Select.Item
                key={choice.value}
                value={choice.value}
                className={cn(
                  "flex h-8 cursor-default select-none items-center justify-between gap-3 rounded-lg px-2",
                  "text-[13px] text-ink-2 outline-none",
                  "data-[highlighted]:bg-frame-hover data-[highlighted]:text-ink data-[state=checked]:font-medium data-[state=checked]:text-ink",
                )}
              >
                <Select.ItemText>{choice.label}</Select.ItemText>
                <Select.ItemIndicator>
                  <AppIcon name="check" size={14} strokeWidth={2} className="text-ink-3" />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  )
}
