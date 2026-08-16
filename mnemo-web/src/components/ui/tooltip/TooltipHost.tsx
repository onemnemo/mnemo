import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

import { formatChordParts } from "@/keybinds/chord"
import { cn } from "@/lib/utils"

import { placeTooltip, type Placement, type TooltipSide } from "./placement"

/**
 * The one tooltip in the app.
 *
 * A single host rather than a wrapper per control, for two reasons. A tooltip is modal in
 * the small: only one is ever on screen, so one element that moves is a truer model than
 * hundreds that mount and unmount. And it lets the host read `title` as well as its own
 * attributes, which is what replaces the OS tooltip everywhere at once instead of only
 * where someone remembered to opt in.
 *
 * Sites that want more than a line of text (a shortcut on a cap, a chosen side) say so
 * with the Tooltip component next door; everything else keeps its `title` and is upgraded
 * where it stands.
 */

/** How long the pointer rests before the first tooltip appears. */
const SHOW_DELAY = 400
/**
 * After one closes the next opens with no delay for this long, so running along a toolbar
 * reads as one surface answering rather than six controls each making you wait.
 */
const WARM_WINDOW = 320
const OFFSET = 8
const EDGE_PADDING = 8

const SIDES: readonly TooltipSide[] = ["top", "bottom", "left", "right"]

interface Shown {
  readonly anchor: HTMLElement
  readonly label: string
  readonly chord: string | null
  readonly side: TooltipSide
}

function sideOf(value: string | null): TooltipSide {
  return SIDES.find((side) => side === value) ?? "top"
}

/** The nearest ancestor that has something to say, and what it says. */
function hintFor(target: EventTarget | null): Shown | null {
  if (!(target instanceof Element)) return null
  const anchor = target.closest<HTMLElement>("[data-tooltip],[title]")
  if (!anchor) return null

  const own = anchor.getAttribute("data-tooltip")
  if (own) {
    return {
      anchor,
      label: own,
      chord: anchor.getAttribute("data-tooltip-chord"),
      side: sideOf(anchor.getAttribute("data-tooltip-side")),
    }
  }

  const title = anchor.getAttribute("title")
  if (!title) return null
  // Text being edited is not chrome, and taking an attribute off a node ProseMirror owns
  // is a document mutation as far as it is concerned. Editor controls opt in with
  // data-tooltip instead, which is read rather than moved.
  if (anchor.isContentEditable) return null
  return { anchor, label: title, chord: null, side: "top" }
}

export function TooltipHost() {
  const [shown, setShown] = useState<Shown | null>(null)
  const [placement, setPlacement] = useState<Placement | null>(null)
  const tipRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let timer = 0
    let anchor: HTMLElement | null = null
    let lastHide = 0
    // A press means the pointer is doing something, not asking what a thing is.
    let pressed = false

    /**
     * The control the pointer is on, and the `title` taken off it while it is there.
     *
     * Chromium reads `title` on the move that lands on a control and then shows the OS tooltip from
     * a timer of its own, which nothing on the page can see or call off. Taking the attribute away
     * once ours is up is therefore too late: the OS one is already coming, which is how both ended
     * up on screen at once and why a control sometimes showed only the OS one. So the attribute
     * comes off the moment the pointer arrives, ahead of either timer, and goes back when it leaves.
     */
    let latched: { anchor: HTMLElement; title: string | null; named: boolean } | null = null

    function latch(next: Shown): void {
      const title = next.anchor.getAttribute("title")
      if (title == null) {
        latched = { anchor: next.anchor, title: null, named: false }
        return
      }
      next.anchor.removeAttribute("title")
      // `title` is the accessible name wherever a control has no words of its own, so lend the same
      // words back for as long as the attribute is borrowed.
      const named =
        !next.anchor.hasAttribute("aria-label") &&
        !next.anchor.hasAttribute("aria-labelledby") &&
        !next.anchor.textContent?.trim()
      if (named) next.anchor.setAttribute("aria-label", title)
      latched = { anchor: next.anchor, title, named }
    }

    function release(): void {
      if (!latched) return
      const { anchor: held, title, named } = latched
      latched = null
      if (title == null) return
      if (named) held.removeAttribute("aria-label")
      // Put back rather than restored blindly: a re-render may have written its own title in the
      // meantime, and that one is the current answer.
      if (!held.hasAttribute("title")) held.setAttribute("title", title)
    }

    function cancel(): void {
      if (timer) {
        window.clearTimeout(timer)
        timer = 0
      }
    }

    function hide(): void {
      cancel()
      if (!anchor) return
      anchor = null
      lastHide = Date.now()
      setShown(null)
    }

    function show(next: Shown): void {
      timer = 0
      anchor = next.anchor
      setShown(next)
    }

    function request(target: EventTarget | null, immediate: boolean): void {
      // Still on the control that was read on the way in. Reading it again would restart the delay
      // every time the pointer crossed an icon inside a button, and its title is not there to read.
      if (latched && target instanceof Node && latched.anchor.contains(target)) return
      release()
      const next = hintFor(target)
      if (!next) {
        hide()
        return
      }
      cancel()
      latch(next)
      if (immediate || Date.now() - lastHide < WARM_WINDOW) {
        show(next)
        return
      }
      timer = window.setTimeout(() => show(next), SHOW_DELAY)
    }

    function onOver(event: PointerEvent): void {
      // Touch has no hover, and a tooltip on tap is a control that ate your tap.
      if (event.pointerType === "touch" || pressed) return
      request(event.target, false)
    }

    function onMove(): void {
      // A control can be unmounted from under a resting pointer, which produces no
      // boundary event at all and would otherwise leave its tooltip stranded.
      if (latched && !latched.anchor.isConnected) {
        // Gone, so there is nothing to hand the title back to.
        latched = null
        hide()
      }
    }

    /** The pointer left the window. Whatever it was resting on gets its title back. */
    function onLeave(): void {
      hide()
      release()
    }

    function onDown(): void {
      pressed = true
      hide()
    }

    /**
     * Focus left. A control the pointer is not on gets its title straight back, which is the
     * keyboard's path through a toolbar. One the pointer is resting on keeps it borrowed: the OS
     * tooltip there is only a mouse move away, and that move is what our own hint is answering.
     */
    function onBlur(): void {
      hide()
      if (latched && !latched.anchor.matches(":hover")) release()
    }

    function onUp(): void {
      pressed = false
    }

    function onFocus(event: FocusEvent): void {
      // Only keyboard focus. Clicking a button focuses it too, and popping a hint over
      // what you just pressed is how a toolbar starts flashing at every click.
      const target = event.target
      if (!(target instanceof Element) || !target.matches(":focus-visible")) return
      request(target, true)
    }

    document.addEventListener("pointerover", onOver)
    document.addEventListener("pointerleave", onLeave)
    document.addEventListener("pointermove", onMove)
    document.addEventListener("pointerdown", onDown, true)
    document.addEventListener("pointerup", onUp, true)
    document.addEventListener("pointercancel", onUp, true)
    document.addEventListener("focusin", onFocus)
    document.addEventListener("focusout", onBlur)
    document.addEventListener("keydown", hide)
    // Capture, because the scroll that moves a control out from under its tooltip is
    // almost never the one on document itself.
    document.addEventListener("scroll", hide, true)
    window.addEventListener("blur", hide)

    return () => {
      cancel()
      release()
      document.removeEventListener("pointerover", onOver)
      document.removeEventListener("pointerleave", onLeave)
      document.removeEventListener("pointermove", onMove)
      document.removeEventListener("pointerdown", onDown, true)
      document.removeEventListener("pointerup", onUp, true)
      document.removeEventListener("pointercancel", onUp, true)
      document.removeEventListener("focusin", onFocus)
      document.removeEventListener("focusout", onBlur)
      document.removeEventListener("keydown", hide)
      document.removeEventListener("scroll", hide, true)
      window.removeEventListener("blur", hide)
    }
  }, [])

  // Measured then placed, in a layout effect so the two renders are one paint and the
  // tooltip is never seen at the origin.
  useLayoutEffect(() => {
    const tip = tipRef.current
    if (!shown || !tip) {
      setPlacement(null)
      return
    }
    const anchor = shown.anchor.getBoundingClientRect()
    const box = tip.getBoundingClientRect()
    setPlacement(
      placeTooltip(
        { x: anchor.x, y: anchor.y, width: anchor.width, height: anchor.height },
        { width: box.width, height: box.height },
        { width: window.innerWidth, height: window.innerHeight },
        shown.side,
        { offset: OFFSET, padding: EDGE_PADDING },
      ),
    )
  }, [shown])

  if (!shown) return null

  const keys = shown.chord ? formatChordParts(shown.chord) : []

  return createPortal(
    <div
      // Keyed on the text so the entrance replays for each control, rather than once for
      // the first of a run and never again as the one element slides between them.
      key={shown.label}
      ref={tipRef}
      role="presentation"
      aria-hidden
      className={cn(
        "animate-pop-in pointer-events-none fixed z-[300] flex h-[30px] items-center gap-2 rounded-[10px]",
        "bg-tooltip-surface text-[12.5px] font-medium tracking-[-0.004em] text-tooltip-ink shadow-pop",
        // The caps carry their own inset, so the right side closes up when there are any.
        keys.length > 0 ? "pl-2.5 pr-2" : "px-2.5",
      )}
      // Placed with left/top rather than a transform: the entrance animates transform, and
      // a keyframe beats an inline style, which would snap the tooltip to the origin for
      // the length of it.
      style={{
        left: placement?.x ?? 0,
        top: placement?.y ?? 0,
        visibility: placement ? "visible" : "hidden",
      }}
    >
      <span className="whitespace-nowrap">{shown.label}</span>
      {keys.map((key, index) => (
        <kbd
          key={`${key}:${index}`}
          className="grid h-[18px] min-w-[18px] place-items-center rounded-[5px] bg-tooltip-key px-1 font-sans text-[11px] font-semibold text-tooltip-key-ink"
        >
          {key}
        </kbd>
      ))}
    </div>,
    document.body,
  )
}
