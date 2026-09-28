import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

/** A panel section's name, with an optional text button on the right. */
export function PanelHeader({ label, spaced, action }: { label: string; spaced?: boolean; action?: ReactNode }) {
  return (
    <div className={cn("flex h-6 items-center justify-between px-1 pb-1", spaced && "mt-1.5")}>
      <span className="text-[11px] font-semibold tracking-[0.04em] text-ink-3 uppercase">{label}</span>
      {action}
    </div>
  )
}

/** The small text button a header can carry. */
export function HeaderAction({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-[22px] items-center gap-[5px] rounded-md px-1.5 text-[12px] text-ink-2 outline-none",
        "transition-colors duration-(--duration-press) ease-[ease] hover:bg-frame-hover hover:text-ink",
        "focus-visible:ring-2 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-45",
      )}
    >
      {children}
      {label}
    </button>
  )
}

/** A hairline across a panel. */
export function PanelRule({ tight }: { tight?: boolean }) {
  return <div aria-hidden className={cn("h-px bg-line-soft", tight ? "m-1" : "mx-1 my-2")} />
}
