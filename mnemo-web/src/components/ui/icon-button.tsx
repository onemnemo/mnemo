import { type ButtonHTMLAttributes, forwardRef } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { cn } from "@/lib/utils"

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> {
  icon: string
  iconSize?: number
  /** Accessible label; also the tooltip. */
  label: string
}

/** Ghost square icon button (sidebar collapse, topbar bell, etc.). */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, iconSize = 16, label, className, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "inline-grid place-items-center rounded-md p-1.5 text-text-tertiary transition-colors",
        "hover:bg-[var(--nav-button-hover)] hover:text-text-primary disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <AppIcon name={icon} size={iconSize} />
    </button>
  )
})
