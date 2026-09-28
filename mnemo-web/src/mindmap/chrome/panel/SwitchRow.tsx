import { cn } from "@/lib/utils"

/**
 * A title, an optional subline, and a switch. The whole row is the control, which is why the track
 * and knob are drawn here rather than by the app's switch, itself a button a button cannot hold.
 */
export function SwitchRow({
  title,
  detail,
  on,
  disabled,
  onToggle,
}: {
  title: string
  detail?: string
  on: boolean
  disabled?: boolean
  onToggle: (on: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onToggle(!on)}
      className={cn(
        "flex min-h-9 w-full items-center gap-2.5 rounded-[9px] p-1 text-left outline-none",
        "focus-visible:ring-2 focus-visible:ring-accent",
        disabled && "pointer-events-none opacity-45",
      )}
    >
      <span className="flex grow flex-col gap-0.5">
        <span className="text-[12.5px] font-medium text-ink">{title}</span>
        {detail ? <span className="text-[11.5px] text-ink-3">{detail}</span> : null}
      </span>
      <span
        aria-hidden
        className={cn(
          "relative h-4 w-7 shrink-0 rounded-full transition-colors duration-(--duration-normal) ease-[ease]",
          on ? "bg-solid" : "bg-frame-active",
        )}
      >
        <span
          className="absolute top-[2.5px] size-[11px] rounded-full bg-canvas shadow-raised"
          style={{ left: on ? 14.5 : 2.5, transition: "left var(--duration-switch) var(--ease-switch)" }}
        />
      </span>
    </button>
  )
}
