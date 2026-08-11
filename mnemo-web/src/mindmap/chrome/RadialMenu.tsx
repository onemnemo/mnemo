import { useEffect, useRef, useState } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"
import { cn } from "@/lib/utils"

import { RADIAL_INNER, RADIAL_OUTER, sectorAt, wedgePath, type RadialSector } from "./radial"

/** Room around the ring for the wedge stroke, which would otherwise be clipped by the SVG box. */
const EDGE_PAD = 6

export interface RadialMenuProps {
  sectors: readonly RadialSector[]
  /** Where the ring is centred, in pixels from the pane's top left. */
  at: { x: number; y: number }
  onPick: (id: string) => void
  onClose: () => void
}

/**
 * The radial toolkit: hold, flick, release.
 *
 * A ring is not a menu, it is a gesture. Its value is that the target is always the same distance
 * and the same direction from wherever the pointer already is, so after a week the hand knows where
 * a sector lives and the eyes never leave the node. That only holds if it is held open rather than
 * toggled, because a ring you open and then click in is slower than the menu it replaced.
 *
 * Nothing it draws takes pointer events. It finds the sector under the pointer by angle instead,
 * which is what lets the ring open on top of the map without the map losing the gesture underneath
 * it, and it is why the wedges can be drawn as one SVG rather than six hit targets.
 */
export function RadialMenu({ sectors, at, onPick, onClose }: RadialMenuProps) {
  const t = useT()
  const root = useRef<HTMLDivElement>(null)
  const [hot, setHot] = useState<number | null>(null)

  // The window listeners read the live sector and the live callbacks through refs. Closing over
  // them instead would mean tearing the listeners down and re-attaching them on every pointer move
  // that changes the highlight, which is listener churn at the rate of the flick itself.
  const hotRef = useRef<number | null>(null)
  hotRef.current = hot
  const handlers = useRef({ onPick, onClose })
  handlers.current = { onPick, onClose }

  useEffect(() => {
    const node = root.current
    if (node == null) return

    // The centre is in pane pixels and pointer events arrive in client pixels, so the two need the
    // pane's own origin to be compared. Read once when the ring opens: a gesture lasts a few hundred
    // milliseconds, and a layout read per pointer event is exactly the cost this design avoids.
    const origin = node.getBoundingClientRect()

    const move = (event: PointerEvent) => {
      const dx = event.clientX - origin.left - at.x
      const dy = event.clientY - origin.top - at.y
      setHot(sectorAt(dx, dy, sectors.length))
    }

    // Releasing the key fires whatever the pointer is over. That is the gesture, and a release over
    // the hub or inside the dead zone is how it is called off with nothing picked.
    const commit = (event?: Event) => {
      // A press is the other way to fire the sector, and it must not also reach the map underneath.
      // The listener is on the capture phase for exactly that: the pane's own handler would otherwise
      // see the press first, on the way down to its target, and start a marquee under the ring.
      event?.stopPropagation()
      event?.preventDefault()
      const index = hotRef.current
      if (index != null) handlers.current.onPick(sectors[index].id)
      handlers.current.onClose()
    }
    const keyUp = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "q") commit()
    }
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") handlers.current.onClose()
    }

    window.addEventListener("pointermove", move)
    window.addEventListener("pointerdown", commit, true)
    window.addEventListener("keyup", keyUp)
    window.addEventListener("keydown", keyDown)
    return () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerdown", commit, true)
      window.removeEventListener("keyup", keyUp)
      window.removeEventListener("keydown", keyDown)
    }
  }, [at.x, at.y, sectors])

  const box = (RADIAL_OUTER + EDGE_PAD) * 2
  const labelRadius = (RADIAL_INNER + RADIAL_OUTER) / 2
  const step = 360 / sectors.length

  return (
    <div ref={root} className="pointer-events-none absolute inset-0 z-50">
      {/*
        The ring scales in, and the layer that measures the pane must not be the layer that animates:
        a rect read while a scale is running comes back shrunk, and the origin cached from it would be
        off by a percent of the pane for the whole gesture. The inner layer is inset the same as the
        outer, so every position below still resolves against the same box it always did.
      */}
      <div className="absolute inset-0 animate-pop-in">
        <svg
          className="absolute"
          style={{ left: at.x - RADIAL_OUTER - EDGE_PAD, top: at.y - RADIAL_OUTER - EDGE_PAD }}
          width={box}
          height={box}
        >
          <g transform={`translate(${RADIAL_OUTER + EDGE_PAD} ${RADIAL_OUTER + EDGE_PAD})`}>
            {sectors.map((sector, i) => (
              <path
                key={sector.id}
                d={wedgePath(i, sectors.length)}
                strokeWidth={1}
                className={cn(
                  "stroke-line-soft transition-colors duration-75",
                  hot === i
                    ? sector.danger
                      ? "fill-danger-wash"
                      : "fill-frame-active"
                    : "fill-canvas",
                )}
              />
            ))}
          </g>
        </svg>

        {sectors.map((sector, i) => {
          // Labels sit at the middle of the band, on the sector's centre line rather than its edge,
          // which is the same quarter turn the wedges take to put sector 0 straight up.
          const angle = ((i * step - 90) * Math.PI) / 180
          return (
            <div
              key={sector.id}
              style={{
                left: at.x + Math.cos(angle) * labelRadius,
                top: at.y + Math.sin(angle) * labelRadius,
              }}
              className={cn(
                "absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-0.5",
                "transition-colors duration-75",
                hot === i ? (sector.danger ? "text-danger" : "text-ink") : "text-ink-3",
              )}
            >
              {sector.icon != null && <AppIcon name={sector.icon} size={15} strokeWidth={1.8} />}
              <span className="text-[9.5px] font-medium leading-none">
                {t("Mindmap", sector.labelKey)}
              </span>
            </div>
          )
        })}

        {/* The hub is the escape hatch: let go over it and nothing happens. */}
        <div
          style={{ left: at.x, top: at.y }}
          className="absolute flex size-[52px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-canvas shadow-pop"
        >
          <span className="size-1.5 rounded-full bg-ink-3" />
        </div>
      </div>
    </div>
  )
}
