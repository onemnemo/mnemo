import { useEffect, useMemo, useRef, useState } from "react"

import { eventKeyToken } from "@/keybinds/chord"

import { RadialHint, RadialHub, SHOW_RING_HINT } from "./RadialHub"
import { RadialPetals } from "./RadialPetals"
import { RadialScrim, type PaneBox } from "./RadialScrim"
import { HANDOVER_DWELL, RING_START, stepRing, type RingSlot, type RingState } from "./radial"
import { pickOf, type RingSector } from "./sectors"

const NOTHING_INERT: ReadonlySet<string> = new Set()
const NO_CUTOUTS: readonly PaneBox[] = []
const NOTHING_REMEMBERED = () => null

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
  /** Where the targets are on screen, kept clear of the scrim. */
  cutouts?: readonly PaneBox[]
  /** The item last picked from a sector's sub-ring, which a release on the sector repeats. */
  remembered?: (sectorId: string) => string | null
  /** A pick, and the sector it came from. */
  onPick: (id: string, sectorId: string) => void
  onClose: () => void
}

/**
 * The radial toolkit: hold, flick, release. Nothing it draws takes pointer events; it hit-tests by
 * angle and distance, so the map underneath keeps the gesture.
 */
export function RadialMenu({
  sectors,
  inert = NOTHING_INERT,
  at,
  holdKey,
  subject,
  cutouts = NO_CUTOUTS,
  remembered = NOTHING_REMEMBERED,
  onPick,
  onClose,
}: RadialMenuProps) {
  const root = useRef<HTMLDivElement>(null)
  const [ring, setRing] = useState<RingState>(RING_START)
  const hit = ring.hit

  const slots = useMemo(
    (): RingSlot[] => sectors.map((sector) => ({ subs: sector.sub?.length ?? 0, inert: inert.has(sector.id) })),
    [inert, sectors],
  )

  // The window listeners read the live hit and the live callbacks through refs. Closing over them
  // instead would mean tearing the listeners down and re-attaching them on every pointer move that
  // changes the highlight, which is listener churn at the rate of the flick itself.
  const ringRef = useRef<RingState>(RING_START)
  ringRef.current = ring
  const handlers = useRef({ onPick, onClose, remembered })
  handlers.current = { onPick, onClose, remembered }

  useEffect(() => {
    const node = root.current
    if (node == null) return

    // The centre is in pane pixels and pointer events arrive in client pixels, so the two need the
    // pane's own origin to be compared. Read once when the ring opens: a gesture lasts a few hundred
    // milliseconds, and a layout read per pointer event is exactly the cost this design avoids.
    const origin = node.getBoundingClientRect()

    let settle: ReturnType<typeof setTimeout> | undefined
    const track = (dx: number, dy: number, t: number) => {
      const previous = ringRef.current
      const next = stepRing(previous, dx, dy, t, slots)
      ringRef.current = next
      // A pointer that stops dead sends no more events, so the handover dwell is stepped for it.
      clearTimeout(settle)
      if (next.candidate !== null) {
        settle = setTimeout(() => track(dx, dy, t + HANDOVER_DWELL), HANDOVER_DWELL)
      }
      // Rendered only when what is lit changes; the rest of the state rides along in the ref.
      if (next.hit.hot !== previous.hit.hot || next.hit.sub !== previous.hit.sub) {
        setRing(next)
      }
    }
    const move = (event: PointerEvent) =>
      track(event.clientX - origin.left - at.x, event.clientY - origin.top - at.y, event.timeStamp)

    // Releasing the key fires whatever the pointer is over. That is the gesture, and a release over
    // the hub is how it is called off with nothing picked.
    const commit = (event?: Event) => {
      // A press is the other way to fire, and it must not also reach the map underneath. The
      // listener is on the capture phase for exactly that: the pane's own handler would otherwise
      // see the press first, on the way down to its target, and start a marquee under the ring.
      event?.stopPropagation()
      event?.preventDefault()
      const { hot } = ringRef.current.hit
      const picked = pickOf(sectors, ringRef.current.hit, inert, handlers.current.remembered)
      if (picked !== null && hot !== null) handlers.current.onPick(picked, sectors[hot].id)
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
    // The key-up of a hold released in another window never arrives, so leaving the window closes
    // the ring with nothing picked.
    const leave = () => handlers.current.onClose()
    const hidden = () => {
      if (document.hidden) leave()
    }

    window.addEventListener("pointermove", move)
    window.addEventListener("pointerdown", commit, true)
    window.addEventListener("keyup", keyUp)
    window.addEventListener("keydown", keyDown)
    window.addEventListener("blur", leave)
    document.addEventListener("visibilitychange", hidden)
    return () => {
      clearTimeout(settle)
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerdown", commit, true)
      window.removeEventListener("keyup", keyUp)
      window.removeEventListener("keydown", keyDown)
      window.removeEventListener("blur", leave)
      document.removeEventListener("visibilitychange", hidden)
    }
  }, [at.x, at.y, holdKey, inert, sectors, slots])

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
          <RadialHub sectors={sectors} inert={inert} hit={hit} subject={subject} remembered={remembered} />
        </div>
      </div>
      {SHOW_RING_HINT ? <RadialHint holdKey={holdKey} /> : null}
    </div>
  )
}
