import { cn } from "@/lib/utils"

/**
 * A small on/off toggle. A plain accessible button rather than a checkbox so the two read
 * differently on screen: a checkbox is "include this", a switch is "this behaviour is on".
 *
 * On is `solid`, not the brand orange, so the accent keeps meaning Mnemo rather than "on".
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
        "relative inline-flex h-[20px] w-[34px] shrink-0 items-center rounded-full outline-none transition-colors",
        "disabled:pointer-events-none disabled:opacity-40",
        checked ? "bg-solid" : "bg-frame-active",
        className,
      )}
    >
      <span
        className={cn(
          "pointer-events-none inline-block size-[14px] rounded-full bg-canvas shadow-sm transition-transform",
          checked ? "translate-x-[16px]" : "translate-x-[3px]",
        )}
      />
    </button>
  )
}
