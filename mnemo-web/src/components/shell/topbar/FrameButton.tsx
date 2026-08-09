import { type ButtonHTMLAttributes, forwardRef } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { cn } from "@/lib/utils"

interface FrameButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> {
  icon: string
  /** Accessible label; also the tooltip when no separate hint is given. */
  label: string
  /** Tooltip text, when it should say more than the label (a shortcut, usually). */
  hint?: string
  /** Renders as held down, for the controls that toggle something. */
  pressed?: boolean
  strokeWidth?: number
}

/**
 * A control in the window frame.
 *
 * Its own component rather than the shared IconButton because the frame's
 * treatment is deliberately quieter than a module's: larger target, softer
 * corner, and a hover fill that reads against the rail rather than the canvas.
 */
export const FrameButton = forwardRef<HTMLButtonElement, FrameButtonProps>(function FrameButton(
  { icon, label, hint, pressed, strokeWidth = 1.7, className, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={hint ?? label}
      className={cn(
        "grid size-8 shrink-0 place-items-center self-center rounded-lg transition-colors",
        pressed ? "bg-frame-active text-ink" : "text-ink-2 hover:bg-frame-hover hover:text-ink",
        className,
      )}
      style={{ transitionDuration: "var(--duration-fast)" }}
      {...props}
    >
      <AppIcon name={icon} size={16} strokeWidth={strokeWidth} />
    </button>
  )
})
