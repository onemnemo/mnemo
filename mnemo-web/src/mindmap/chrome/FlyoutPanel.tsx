import { useEffect, useRef, type ReactNode } from "react"

import { cn } from "@/lib/utils"

export interface FlyoutPanelProps {
  children: ReactNode
  /** Closes on an outside press or Escape. */
  onClose: () => void
  className?: string
}

/**
 * The surface a tool's sub-choices sit on.
 *
 * It opens upward and centred on whatever control owns it, because the dock sits at the bottom of
 * the pane and a panel below it would be off the map. Positioning is against the nearest positioned
 * ancestor, so the control that owns a flyout is the one that has to be `relative`.
 *
 * The dock's wrapper row is pointer-events-none so it does not swallow clicks along the bottom of
 * the map, which means a panel anchored inside it has to claim presses back for itself.
 */
export function FlyoutPanel({ children, onClose, className }: FlyoutPanelProps) {
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (panel.current?.contains(event.target as Node)) return
      onClose()
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      // The panel is the innermost thing Escape can mean, so it takes the key rather than letting it
      // reach the canvas and clear the selection the panel is about.
      event.stopPropagation()
      onClose()
    }

    // Capture, so both of these land before the canvas does. A press meant only to dismiss the panel
    // would otherwise reach the pane first and start a marquee, or move the selection out from under
    // the panel in the same gesture.
    window.addEventListener("pointerdown", onPointerDown, true)
    window.addEventListener("keydown", onKeyDown, true)
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true)
      window.removeEventListener("keydown", onKeyDown, true)
    }
  }, [onClose])

  return (
    <div
      ref={panel}
      className={cn(
        "pointer-events-auto absolute bottom-[calc(100%+7px)] left-1/2 z-50 -translate-x-1/2 rounded-xl bg-canvas p-1.5 shadow-pop animate-pop-in",
        className,
      )}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  )
}
