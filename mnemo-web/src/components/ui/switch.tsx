import { cn } from "@/lib/utils"

/**
 * A small on/off toggle, the web stand-in for the desktop ToggleSwitch. A plain accessible button
 * rather than a checkbox so the two read differently on screen: a checkbox is "include this", a
 * switch is "this behavior is on".
 */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
  className,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  disabled?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-[20px] w-[34px] shrink-0 items-center rounded-full transition-colors outline-none",
        "focus-visible:ring-2 focus-visible:ring-brand/40 disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-brand" : "bg-[var(--widget-background)] border border-line",
        className,
      )}
    >
      <span
        className={cn(
          "pointer-events-none inline-block size-[14px] rounded-full bg-white shadow-sm transition-transform",
          checked ? "translate-x-[16px]" : "translate-x-[3px]",
        )}
      />
    </button>
  )
}
