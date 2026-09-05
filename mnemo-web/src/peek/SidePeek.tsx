import "./side-peek.css"

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react"

import { AppIcon } from "@/components/icon/AppIcon"
import { useT } from "@/i18n/useT"
import { startEdgeResize, widthFromArrowKey } from "@/lib/edge-resize"
import { cn } from "@/lib/utils"
import { Z_LAYERS } from "@/lib/z-layers"
import { useAiEnabled } from "@/settings/aiEnabled"
import { clampDockWidth, useSomaStore } from "@/stores/soma"

import { PeekBody } from "./PeekBody"
import { PeekHeader } from "./PeekHeader"
import { escapeContextOf, escapeShouldClosePeek } from "./escape"
import {
  escapeClosesPeek,
  PEEK_CANVAS_STRIP,
  PEEK_MAX_WIDTH,
  PEEK_MIN_WIDTH,
  PEEK_RAIL_WIDTH,
  usePeekStore,
} from "./store"
import { usePeekSubject } from "./usePeekSubject"

/**
 * The side peek: one item at a time, read only, beside or over the canvas.
 *
 * Two placements, and the difference is not cosmetic. **Overlay** covers part of the
 * canvas and leaves a strip of it showing. It is for looking: the thing behind it is
 * what is being compared against, and re-wrapping every line of that thing to make room
 * would move the sentence the reader was on, which is the one thing a panel called
 * "don't lose my place" may not do. **Docked** takes a column and the canvas reflows,
 * which is the right trade once the panel is open for an hour rather than for a glance.
 * It is the argument the assistant dock makes about itself.
 *
 * One DOM position for both, because switching placement must not remount: the note
 * renderer's document and its scroll position are the whole value of the panel. Docked
 * right it sits between the canvas and the assistant dock and never past it, since the
 * dock resizes itself from the window's right edge and would jump by this panel's width
 * the first time it was dragged.
 */
export function SidePeek() {
  const t = useT()
  const item = usePeekStore((s) => s.item)
  const nonce = usePeekStore((s) => s.nonce)
  const width = usePeekStore((s) => s.width)
  const placement = usePeekStore((s) => s.placement)
  const side = usePeekStore((s) => s.side)
  const collapsed = usePeekStore((s) => s.collapsed)
  const alpha = usePeekStore((s) => s.alpha)

  // The assistant dock is the peek's only neighbour in this row, so an overlay insets
  // past it rather than covering a panel somebody deliberately opened.
  const assistantOn = useAiEnabled()
  const dockOpen = useSomaStore((s) => s.dockOpen)
  const dockWidth = useSomaStore((s) => s.dockWidth)
  const neighbour = assistantOn && dockOpen ? clampDockWidth(dockWidth) : 0

  const subject = usePeekSubject(item)
  const panel = useRef<HTMLElement | null>(null)
  const endDrag = useRef<(() => void) | null>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const holdsFocus = useRef(false)
  const [row, setRow] = useState(0)

  const open = item !== null
  const docked = placement === "docked"

  useEffect(() => () => endDrag.current?.(), [])

  // Focus moves in on open and back out on close, so the panel is reachable from the
  // keyboard the moment it appears and the row that opened it is where the caller is left
  // afterwards. Only when the panel still holds focus, though: the peek closes itself
  // when its item 404s, leaves the library or is promoted to the canvas, and none of
  // those may pull the caret out of whatever the reader has moved on to.
  useEffect(() => {
    if (!open) return
    const node = panel.current
    const active = document.activeElement
    returnFocus.current = active instanceof HTMLElement ? active : null
    node?.focus()
    // Followed as it moves rather than read at close: by the time this effect's cleanup
    // runs the panel is off the document and focus has already fallen back to the body,
    // so "was the reader still in here" can no longer be asked.
    holdsFocus.current = true
    const onFocusIn = () => {
      holdsFocus.current = Boolean(node?.contains(document.activeElement))
    }
    document.addEventListener("focusin", onFocusIn)

    return () => {
      document.removeEventListener("focusin", onFocusIn)
      const target = returnFocus.current
      const held = holdsFocus.current
      returnFocus.current = null
      holdsFocus.current = false
      if (held && target?.isConnected) target.focus()
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      if (!escapeShouldClosePeek(escapeContextOf(event, escapeClosesPeek()))) return
      usePeekStore.getState().closePeek()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open])

  /*
   * An overlay's strip of canvas is all or nothing, and CSS cannot say that.
   *
   * `max-width: calc(100% - 96px)` against a minimum width settles, between 400 and
   * 496px of canvas, on a one to ninety-five pixel ribbon of module, which is the exact
   * outcome the strip exists to prevent. There is no conditional in CSS for "and if
   * that leaves less than a strip, take all of it", so the row is measured instead.
   */
  useLayoutEffect(() => {
    const parent = panel.current?.parentElement
    if (!parent || !open || docked) return
    // Read before paint rather than waiting for the observer's first callback, which is
    // a frame late: one frame of a panel wider than the canvas is a visible flash.
    setRow(parent.getBoundingClientRect().width)
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry !== undefined) setRow(entry.contentRect.width)
    })
    observer.observe(parent)
    return () => observer.disconnect()
  }, [open, docked])

  if (!item) return null

  const canvas = Math.max(0, row - neighbour)
  const overlayWidth =
    row === 0
      ? width
      : canvas - PEEK_CANVAS_STRIP < PEEK_MIN_WIDTH
        ? canvas
        : Math.min(width, canvas - PEEK_CANVAS_STRIP)
  const shown = collapsed ? PEEK_RAIL_WIDTH : docked ? width : overlayWidth

  const railLabel = subject.title
    ? `${t("App", "PeekExpand")} · ${subject.title}`
    : t("App", "PeekExpand")

  const startResize = (event: React.PointerEvent) => {
    event.preventDefault()
    const box = panel.current?.getBoundingClientRect()
    if (!box) return
    endDrag.current = startEdgeResize({
      anchor: side === "right" ? box.right : box.left,
      growth: side === "right" ? "left" : "right",
      onWidth: (px) => usePeekStore.getState().setWidth(px),
    })
  }

  const onSeparatorKeyDown = (event: React.KeyboardEvent) => {
    const next = widthFromArrowKey(event.key, width, side === "right" ? "left" : "right")
    if (next === null) return
    usePeekStore.getState().setWidth(next)
    event.preventDefault()
  }

  const style: CSSProperties = {
    width: shown,
    // One DOM node on either side of the canvas. Everything else in the row keeps the
    // default order, so a negative one puts the panel first and zero leaves it where
    // the markup does, between the canvas and the assistant dock.
    order: docked && side === "left" ? -1 : 0,
    ...(docked
      ? {}
      : { zIndex: Z_LAYERS.peek, ...(side === "right" ? { right: neighbour } : { left: 0 }) }),
    ["--peek-surface-alpha" as string]: alpha / 100,
  }

  return (
    <aside
      ref={panel}
      role="complementary"
      aria-label={t("App", "PeekLabel")}
      data-peek={placement}
      tabIndex={-1}
      style={style}
      className={cn(
        "flex flex-col outline-none",
        side === "right" ? "border-l border-line-soft" : "border-r border-line-soft",
        docked
          ? // In flow, so the canvas reflows around it. A hairline rather than a shadow:
            // docked it is a neighbour, not something floating over the page.
            "relative shrink-0 bg-canvas"
          : // Out of flow, so the module keeps its width and its line breaks. No scrim:
            // a scrim would say modal, and what is behind an overlay is exactly what is
            // being compared against.
            "peek-surface absolute inset-y-0 shadow-pop",
      )}
    >
      {collapsed ? (
        // Collapsed keeps the item alive and shows only enough of the panel to be found
        // again. Swapping the content out for a rail is the obvious way to write it and
        // it throws away whatever was going on: hiding costs a scroll position,
        // unmounting costs the whole read.
        <button
          type="button"
          // The header is hidden while collapsed, so without the subject here the rail
          // announces only that it is a rail, and a reader who cannot see it has no way
          // to tell which note it is holding.
          aria-label={railLabel}
          title={railLabel}
          onClick={() => usePeekStore.getState().toggleCollapsed()}
          className="flex h-full w-full flex-col items-center pt-2.5 text-ink-3 transition-colors hover:bg-frame-hover hover:text-ink"
        >
          <AppIcon name={side === "right" ? "panel-left" : "common/panel-right"} size={14} />
        </button>
      ) : null}

      {/* A 7px target straddling the 1px seam. The seam is the thing you aim at, and a
          border you can only hit dead on is a border you miss. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t("App", "PeekResize")}
        aria-valuenow={width}
        aria-valuemin={PEEK_MIN_WIDTH}
        aria-valuemax={PEEK_MAX_WIDTH}
        tabIndex={0}
        onPointerDown={startResize}
        onKeyDown={onSeparatorKeyDown}
        className={cn(
          "absolute top-0 z-10 h-full w-[7px] cursor-col-resize outline-none",
          side === "right" ? "-left-[3px]" : "-right-[3px]",
          collapsed && "hidden",
        )}
      />

      <div className={cn("flex min-h-0 flex-1 flex-col", collapsed && "hidden")}>
        <PeekHeader title={subject.title} subtitle={subject.subtitle} onOpenFull={subject.openFull} />
        {/* Keyed, so a refresh or a different item is a fresh surface rather than the
            last one wearing a new title, and so no renderer is ever handed a document
            it did not mount with. */}
        <PeekBody
          key={`${item.kind}:${"id" in item ? item.id : ""}:${nonce}`}
          item={item}
          refresh={nonce}
        />
      </div>
    </aside>
  )
}
