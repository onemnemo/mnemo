import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react"

import { cn } from "@/lib/utils"

import { panBy, scaled, zoomAt, type Frame, type View } from "./geometry"

/**
 * The frame, and the picture moving under it.
 *
 * The frame is fixed and the image moves, rather than a rectangle dragged over a still picture.
 * Every consumer here is placing an image into a slot whose shape it already knows, so what is
 * inside this box is exactly what renders. There is no dimmed surround, because a dimmed area
 * reads as still included rather than as discarded.
 *
 * Not a dialog. The day a settings page wants an inline cropper with no modal around it, this is
 * already that component.
 */

/** Ceiling on the frame, so a tall crop does not eat the whole dialog. */
const MAX_FRAME_HEIGHT = 340

/** Wheel delta to zoom factor. Tuned so one notch of a mouse wheel is a visible but small step. */
const WHEEL_ZOOM_RATE = 0.0022

const NUDGE_STEP = 0.01
const NUDGE_STEP_LARGE = 0.1
const KEY_ZOOM_FACTOR = 1.1

/** Below this the axis has no overhang worth dragging, so the cursor stops promising one. */
const OVERHANG_EPSILON = 0.5

export function CropStage({
  src,
  ratio,
  aspect,
  view,
  onView,
  label,
  className,
}: {
  src: string
  /** The source's natural width over its height. */
  ratio: number
  /** The frame's. */
  aspect: number
  view: View
  onView: (next: View) => void
  /** Accessible name, describing the drag, the wheel and the arrow keys. Localized by the caller. */
  label: string
  className?: string
}) {
  const host = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const [hostWidth, setHostWidth] = useState(0)

  useLayoutEffect(() => {
    const element = host.current
    if (!element) return
    // Width only. The frame's height is written from it, and observing both is a feedback loop
    // the browser cuts off with a console warning.
    let last = 0
    const observer = new ResizeObserver(() => {
      const width = element.clientWidth
      if (width !== last) {
        last = width
        setHostWidth(width)
      }
    })
    observer.observe(element)
    setHostWidth(element.clientWidth)
    return () => observer.disconnect()
  }, [])

  // The frame fits inside the host both ways: width led, until the aspect gets tall enough that
  // the height ceiling binds instead.
  const fw = Math.max(1, Math.min(hostWidth, MAX_FRAME_HEIGHT * aspect))
  const fh = fw / aspect
  const frame: Frame = { fw, fh, ratio }

  const { sw, sh } = scaled(frame, view.zoom)

  const drag = useRef<{ x: number; y: number } | null>(null)

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    // Captured, or a fast drag that leaves the box stops tracking half way.
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { x: event.clientX, y: event.clientY }
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const from = drag.current
    if (!from) return
    drag.current = { x: event.clientX, y: event.clientY }
    onView(panBy(view, event.clientX - from.x, event.clientY - from.y, frame))
  }

  function onPointerUp() {
    drag.current = null
  }

  useEffect(() => {
    const element = box.current
    if (!element) return
    const frame: Frame = { fw, fh, ratio }
    const onWheel = (event: WheelEvent) => {
      // Non passive, or the dialog behind scrolls instead of the frame zooming. A bare wheel with
      // no modifier is unambiguous here, since the box is not a scrolling surface.
      event.preventDefault()
      const rect = element.getBoundingClientRect()
      const next = view.zoom * Math.exp(-event.deltaY * WHEEL_ZOOM_RATE)
      onView(zoomAt(view, next, event.clientX - rect.left, event.clientY - rect.top, frame))
    }
    element.addEventListener("wheel", onWheel, { passive: false })
    return () => element.removeEventListener("wheel", onWheel)
  }, [view, fw, fh, ratio, onView])

  // The stage takes focus as one thing rather than as a grid of stops. Nudging is why that
  // matters: the reason anyone reopens a crop is to move it slightly, and a mouse cannot do
  // slightly.
  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const frame: Frame = { fw, fh, ratio }
      const step = event.shiftKey ? NUDGE_STEP_LARGE : NUDGE_STEP
      const nudge = (dx: number, dy: number) => {
        event.preventDefault()
        // Mirrors panBy: an axis with no overhang has nowhere to move, so it stays pinned to
        // centre instead of drifting off zero point five and lighting Reset for nothing.
        const overhangX = sw - fw
        const overhangY = sh - fh
        onView({
          ...view,
          ox: overhangX > OVERHANG_EPSILON ? Math.min(1, Math.max(0, view.ox + dx)) : 0.5,
          oy: overhangY > OVERHANG_EPSILON ? Math.min(1, Math.max(0, view.oy + dy)) : 0.5,
        })
      }
      const zoom = (factor: number) => {
        event.preventDefault()
        onView(zoomAt(view, view.zoom * factor, fw / 2, fh / 2, frame))
      }

      switch (event.key) {
        case "ArrowLeft":
          return nudge(-step, 0)
        case "ArrowRight":
          return nudge(step, 0)
        case "ArrowUp":
          return nudge(0, -step)
        case "ArrowDown":
          return nudge(0, step)
        case "+":
        case "=":
          return zoom(KEY_ZOOM_FACTOR)
        case "-":
        case "_":
          return zoom(1 / KEY_ZOOM_FACTOR)
        case "0":
          event.preventDefault()
          return onView({ zoom: 1, ox: 0.5, oy: 0.5 })
      }
    },
    [view, onView, fw, fh, ratio, sw, sh],
  )

  const movable = sw - fw > OVERHANG_EPSILON || sh - fh > OVERHANG_EPSILON

  return (
    <div ref={host} className={cn("flex w-full items-center justify-center", className)}>
      <div
        ref={box}
        tabIndex={0}
        role="application"
        aria-label={label}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        style={{ width: fw, height: fh }}
        className={cn(
          // shrink-0 because the box carries its size in `style`, and a flex child squeezed below
          // that would leave the image geometry computing against a width the frame no longer has.
          "relative shrink-0 select-none overflow-hidden rounded-lg bg-canvas-sunken touch-none",
          movable ? "cursor-grab active:cursor-grabbing" : "cursor-default",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        )}
      >
        <img
          src={src}
          alt=""
          draggable={false}
          className="absolute max-w-none"
          style={{
            width: sw,
            height: sh,
            left: -(view.ox * (sw - fw)),
            top: -(view.oy * (sh - fh)),
          }}
        />

        {/* Corner ticks rather than a full border: they mark the edge where the picture runs to the
            same tone as the dialog and stay out of the way where it does not. The halo is the
            opposite ink to the tick itself, so both survive a white sky and a dark one. */}
        <span aria-hidden className="pointer-events-none absolute inset-0">
          {[
            "left-1.5 top-1.5 border-l border-t",
            "right-1.5 top-1.5 border-r border-t",
            "bottom-1.5 left-1.5 border-b border-l",
            "bottom-1.5 right-1.5 border-b border-r",
          ].map((corner) => (
            <i
              key={corner}
              className={cn(
                "absolute size-3 border-canvas/90 drop-shadow-[0_0_1px_var(--ink)]",
                corner,
              )}
            />
          ))}
        </span>
      </div>
    </div>
  )
}
