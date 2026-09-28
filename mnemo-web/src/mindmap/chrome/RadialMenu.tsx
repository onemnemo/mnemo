import { useEffect, useMemo, useRef, useState } from "react"

import { eventKeyToken } from "@/keybinds/chord"

import { RadialHint, RadialHub, SHOW_RING_HINT } from "./RadialHub"
import { RadialPetals } from "./RadialPetals"
import { RadialScrim, type PaneBox } from "./RadialScrim"
import { NO_HIT, ringHit, type RingHit, type RingSlot } from "./radial"
import { pickOf, type RingSector } from "./sectors"

const NOTHING_INERT: ReadonlySet<string> = new Set()
const NO_CUTOUTS: readonly PaneBox[] = []

export interface RadialMenuProps {
  sectors: readonly RingSector[]
  /** Sectors that do not apply to this selection. Drawn dimmed and never hot, so every direction keeps its meaning. */
  inert?: ReadonlySet<string>
  /** The ring's centre, in pixels from the pane's top left, already clamped to keep the ring inside it. */
  at: { x: number; y: number }
  /**
   * The key token holding the ring open, whose release fires what the pointer is over.
   *
   * It comes from whichever chord opened the ring rather than being a letter written in here,
   * because the shortcut is the user's to rebind and a ring that only closes on the key it shipped
   * with would be stuck open the moment they did.
   */
  holdKey: string
  /** What the ring acts on, which the hub names at rest. */
  subject: string
  /** Where the selection is on screen, kept clear of the scrim. */
  cutouts?: readonly PaneBox[]
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
 * Nothing it draws takes pointer events. It finds what is under the pointer by angle and distance
 * instead, which is what lets the ring open on top of the map without the map losing the gesture
 * underneath it.
 */
export function RadialMenu({
  sectors,
  inert = NOTHING_INERT,
  at,
  holdKey,
  subject,
  cutouts = NO_CUTOUTS,
  onPick,
  onClose,
}: RadialMenuProps) {
  const root = useRef<HTMLDivElement>(null)
  const [hit, setHit] = useState<RingHit>(NO_HIT)

  const slots = useMemo(
    (): RingSlot[] => sectors.map((sector) => ({ subs: sector.sub?.length ?? 0, inert: inert.has(sector.id) })),
    [inert, sectors],
  )

  // The window listeners read the live hit and the live callbacks through refs. Closing over them
  // instead would mean tearing the listeners down and re-attaching them on every pointer move that
  // changes the highlight, which is listener churn at the rate of the flick itself.
  const hitRef = useRef<RingHit>(NO_HIT)
  hitRef.current = hit
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
      const previous = hitRef.current
      const next = ringHit(event.clientX - origin.left - at.x, event.clientY - origin.top - at.y, slots, previous.hot)
      if (next.hot !== previous.hot || next.sub !== previous.sub) {
        hitRef.current = next
        setHit(next)
      }
    }

    // Releasing the key fires whatever the pointer is over. That is the gesture, and a release over
    // the hub is how it is called off with nothing picked.
    const commit = (event?: Event) => {
      // A press is the other way to fire, and it must not also reach the map underneath. The
      // listener is on the capture phase for exactly that: the pane's own handler would otherwise
      // see the press first, on the way down to its target, and start a marquee under the ring.
      event?.stopPropagation()
      event?.preventDefault()
      const picked = pickOf(sectors, hitRef.current)
      if (picked !== null) handlers.current.onPick(picked)
      handlers.current.onClose()
    }
    const keyUp = (event: KeyboardEvent) => {
      // The key alone, not the whole chord: a modifier let go a moment before the letter is still
      // the end of the same gesture, and waiting for the exact combination would drop the pick.
      if (eventKeyToken(event) === holdKey) commit()
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
  }, [at.x, at.y, holdKey, sectors, slots])

  return (
    <div ref={root} className="pointer-events-none absolute inset-0 z-50 overflow-hidden">
      <RadialScrim cutouts={cutouts} />
      {/*
        The ring scales in, and the layer that measures the pane must not be the layer that animates:
        a rect read while a scale is running comes back shrunk, and the origin cached from it would be
        off for the whole gesture. The inner layer is inset the same as the outer, so every position
        below still resolves against the same box.
      */}
      <div className="absolute inset-0 animate-pop-in" style={{ transformOrigin: `${at.x}px ${at.y}px` }}>
        <div className="absolute" style={{ left: at.x, top: at.y }}>
          <RadialPetals sectors={sectors} inert={inert} hit={hit} />
          <RadialHub sectors={sectors} hit={hit} subject={subject} />
        </div>
      </div>
      {SHOW_RING_HINT ? <RadialHint holdKey={holdKey} /> : null}
    </div>
  )
}
