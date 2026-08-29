import { useEffect, type HTMLAttributes, type ReactNode } from "react"
import { createPortal } from "react-dom"

import { AppIcon } from "@/components/icon/AppIcon"
import { cn } from "@/lib/utils"
import { Z_LAYERS } from "@/lib/z-layers"

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  /** Sits beside the title: a scope picker, a path, a breadcrumb. */
  headerExtra?: ReactNode
  /** Sits before the close button: a search field, a mode switch for the dialog's content. */
  headerRight?: ReactNode
  footer?: ReactNode
  /** Accessible name for the close button, localized by the caller. */
  closeLabel: string
  width?: number
  /**
   * Overrides the default ceiling. For a dialog whose content has a fixed aspect (a page
   * preview), height is what decides how big that content gets drawn, and the default is
   * tuned for dialogs that merely scroll.
   */
  maxHeight?: string
  /**
   * Handlers for the dialog as a whole rather than its body. Drag and drop is the case that
   * needs it: a drop target that stops at the edge of the scrolling area is one you can miss
   * by aiming at the title.
   */
  surface?: HTMLAttributes<HTMLDivElement>
  children: ReactNode
  className?: string
}

/**
 * The app's dialog shell: portal, wash, header, body row, footer.
 *
 * Hand-built rather than Radix Dialog because the body is a *row* here, not a column. The
 * widget gallery puts a category rail beside a scrolling grid, and both have to reach the
 * dialog's full height; a component that owns the padding and stacks its children cannot
 * express that without every caller undoing it.
 *
 * It still stamps `role="dialog"` and `data-state="open"`, which is what `isModalOpen()` reads,
 * so a window shortcut stays suppressed while one of these is on screen exactly as it does
 * under a Radix dialog.
 */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  headerExtra,
  headerRight,
  footer,
  closeLabel,
  width = 720,
  maxHeight = "min(680px, 88vh)",
  surface,
  children,
  className,
}: ModalProps) {
  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return
      // Stopped here so a page that also answers Escape (the board's edit session does) does not
      // act on the same press that closed the dialog.
      event.stopPropagation()
      onClose()
    }
    document.addEventListener("keydown", onKeyDown, true)
    return () => document.removeEventListener("keydown", onKeyDown, true)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div
      className="animate-fade-in fixed inset-0 flex items-center justify-center p-8"
      style={{ zIndex: Z_LAYERS.modal }}
    >
      {/* A wash rather than a heavy scrim: the app behind stays legible, which is the point of a
          dialog you opened from a specific tile. */}
      <div className="absolute inset-0 bg-ink/25 backdrop-blur-[2px]" onClick={onClose} />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-state="open"
        style={{ width, maxHeight }}
        {...surface}
        className={cn(
          "animate-pop-in relative flex max-w-full flex-col overflow-hidden rounded-2xl bg-canvas shadow-pop",
          className,
        )}
      >
        <header
          className={cn(
            "flex shrink-0 gap-3 px-5 pb-3 pt-4",
            headerExtra || headerRight ? "items-center" : "items-start justify-between",
          )}
        >
          <div className={cn("min-w-0", headerExtra && "shrink-0")}>
            <h2 className="whitespace-nowrap text-[15px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
            {subtitle && <p className="mt-0.5 truncate text-[12.5px] text-ink-3">{subtitle}</p>}
          </div>
          {headerExtra}
          {(headerExtra || headerRight) && <div className="flex-1" />}
          {headerRight}
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="grid size-7 shrink-0 place-items-center rounded-md text-ink-3 transition-colors hover:bg-frame-hover hover:text-ink"
            style={{ transitionDuration: "var(--duration-fast)" }}
          >
            <AppIcon name="x" size={16} strokeWidth={1.8} />
          </button>
        </header>

        <div className="flex min-h-0 flex-1">{children}</div>

        {footer && (
          <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-line-soft px-5 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  )
}
