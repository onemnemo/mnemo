import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"

import { cn } from "@/lib/utils"

import { FLYOUT_GAP, flyoutSide } from "./anchor"

export interface FlyoutPanelProps {
  children: ReactNode
  /** Closes on an outside press or Escape. */
  onClose: () => void
  className?: string
}

/**
 * The surface a tool's sub-choices sit on.
 *
 * Centred on whatever control owns it and opening upward where there is room, because these hang off
 * floating bars and a bar sits over the thing it is about. Where there is not, the panel flips below
 * rather than disappearing behind the header: a node bar clamped against the top of the pane has no
 * space above it at all, and a tall panel opened from there used to be most of the way off screen.
 *
 * Positioning is against the nearest positioned ancestor, so the control that owns a flyout is the
 * one that has to be `relative`, and the room to work with is the mindmap pane's, marked with
 * `data-mm-pane`.
 *
 * The dock's wrapper row is pointer-events-none so it does not swallow clicks along the bottom of
 * the map, which means a panel anchored inside it has to claim presses back for itself.
 */
export function FlyoutPanel({ children, onClose, className }: FlyoutPanelProps) {
  const panel = useRef<HTMLDivElement>(null)
  const [side, setSide] = useState<"above" | "below">("above")

  // Before paint rather than after, so the panel opens on the side it belongs on instead of
  // appearing above and then jumping.
  useLayoutEffect(() => {
    const choose = () => {
      const node = panel.current
      const control = node?.offsetParent
      if (!node || !control) {
        return
      }
      // The pane where there is one. The window is only a fallback, and a poor one, since a panel
      // that clears the top of the window is still behind the app's header.
      const bounds = node.closest("[data-mm-pane]")?.getBoundingClientRect()
      setSide(
        flyoutSide(
          control.getBoundingClientRect(),
          bounds ?? { top: 0, bottom: window.innerHeight },
          node.offsetHeight,
        ),
      )
    }

    choose()
    // A window dragged short can take the room away underneath a panel that is already open.
    window.addEventListener("resize", choose)
    return () => window.removeEventListener("resize", choose)
  }, [])

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
        "pointer-events-auto absolute left-1/2 z-50 -translate-x-1/2 rounded-xl bg-canvas p-1.5 shadow-pop animate-pop-in",
        className,
      )}
      style={
        side === "above"
          ? { bottom: `calc(100% + ${FLYOUT_GAP}px)` }
          : { top: `calc(100% + ${FLYOUT_GAP}px)` }
      }
      onPointerDown={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  )
}
