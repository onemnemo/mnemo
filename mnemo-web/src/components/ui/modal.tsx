import { useEffect, useRef, type HTMLAttributes, type ReactNode } from "react"
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
 *
 * Tab is kept inside it and the control that opened it gets focus back on close, both of which
 * a Radix dialog would have done. A menu opened from inside portals outside this element, so
 * the trap steps aside while one is open rather than pulling focus out of it.
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
  const surfaceRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Tab") {
        trapTab(surfaceRef.current, event)
        return
      }

      if (event.key !== "Escape") return
      // A menu or a select opened from inside owns the press first, and this listener runs in the
      // capture phase, so without this the dialog closed out from under an open menu and took the
      // press with it.
      if (layerOpenOutside(surfaceRef.current)) return
      // Stopped here so a page that also answers Escape (the board's edit session does) does not
      // act on the same press that closed the dialog.
      event.stopPropagation()
      onClose()
    }
    document.addEventListener("keydown", onKeyDown, true)
    return () => document.removeEventListener("keydown", onKeyDown, true)
  }, [open, onClose])

  // Read on the way in rather than on the way out: by then focus is wherever the dialog left it.
  // Then focus moves inside, to the first control or to the surface itself, because the Tab
  // trap only guards focus that is already in here and a dialog nobody is standing in is one
  // the keyboard walks straight past.
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement
    const surface = surfaceRef.current
    if (surface && !surface.contains(opener)) (tabbable(surface)[0] ?? surface).focus()
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [open])

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
        ref={surfaceRef}
        tabIndex={-1}
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

/**
 * Whether something that answers Escape itself is open outside the dialog.
 *
 * Radix takes its menu and select surfaces out of the tree when they close, so one being in the
 * document is one being open, and they portal to the body rather than into the dialog they were
 * opened from.
 */
function layerOpenOutside(surface: HTMLElement | null): boolean {
  const layers = document.querySelectorAll<HTMLElement>('[role="menu"],[role="listbox"]')
  return [...layers].some((layer) => !surface?.contains(layer))
}

/** Anything focusable and on screen, in the order Tab would visit it. */
function tabbable(root: HTMLElement): HTMLElement[] {
  const candidates = root.querySelectorAll<HTMLElement>(
    'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
  )
  return [...candidates].filter(
    (element) => !element.hasAttribute("disabled") && element.getAttribute("aria-hidden") !== "true",
  )
}

/**
 * Wraps Tab around the dialog's own controls.
 *
 * Skipped while focus is somewhere else entirely, which is what a menu or a select opened from
 * inside looks like: those portal to the body, and dragging focus back out of one would make the
 * options unreachable by keyboard.
 */
function trapTab(surface: HTMLElement | null, event: KeyboardEvent): void {
  if (!surface) return
  const active = document.activeElement
  if (!(active instanceof HTMLElement) || !surface.contains(active)) return

  const stops = tabbable(surface)
  if (stops.length === 0) return

  const first = stops[0]
  const last = stops[stops.length - 1]
  if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  } else if (event.shiftKey && active === first) {
    event.preventDefault()
    last.focus()
  }
}
