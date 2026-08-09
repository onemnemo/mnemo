import type { ButtonHTMLAttributes, ReactNode, Ref } from "react"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * `solid` is near-black in light mode and near-white in dark. Deliberately not
 * accent-coloured: contrast carries the emphasis, and the brand orange stays
 * reserved for the brand.
 */
export type ButtonVariant = "solid" | "outline" | "ghost" | "danger"

/** Two heights, because dense module toolbars and page-level actions are not the same control. */
export type ButtonSize = "sm" | "md"

const VARIANTS: Record<ButtonVariant, string> = {
  solid: "bg-solid text-solid-fg hover:bg-solid-hover",
  outline: "text-ink shadow-[0_0_0_1px_var(--line)] hover:bg-frame-hover",
  ghost: "text-ink-2 hover:bg-frame-hover hover:text-ink",
  // Quiet by default. A destructive action should be findable, not loud: the
  // colour is the warning, and a filled red button turns every dialog into an
  // alarm.
  danger: "text-danger hover:bg-danger-wash",
}

const SIZES: Record<ButtonSize, string> = {
  sm: "h-7 gap-1.5 px-2 text-[12.5px]",
  md: "h-8 gap-1.5 px-2.5 text-[13px]",
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Leading glyph. Sized by the caller; 14px suits both heights. */
  icon?: ReactNode
  trailing?: ReactNode
  /** Render as the single child element instead of a button (menu and popover triggers). */
  asChild?: boolean
  /** React 19 passes ref as an ordinary prop, so there is no forwardRef wrapper. */
  ref?: Ref<HTMLButtonElement>
}

export function Button({
  variant = "solid",
  size = "md",
  icon,
  trailing,
  asChild = false,
  className,
  children,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      type={asChild ? undefined : "button"}
      data-slot="button"
      className={cn(
        "inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-lg",
        "font-medium tracking-[-0.006em] transition-colors",
        "disabled:pointer-events-none disabled:opacity-45",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0",
        SIZES[size],
        VARIANTS[variant],
        className,
      )}
      style={{ transitionDuration: "var(--duration-fast)" }}
      {...props}
    >
      {icon}
      {children}
      {trailing}
    </Comp>
  )
}
