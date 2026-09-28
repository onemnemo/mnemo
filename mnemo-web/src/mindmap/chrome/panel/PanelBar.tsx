import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react"

import { isEditableTarget } from "@/keybinds/chord"
import { cn } from "@/lib/utils"

import { flyoutSide } from "../anchor"
import { useDockedEdge } from "../toolbar/docked-edge"
import { dockClearance } from "../toolbar/placement"

/** Space between a bar and the panel stacked on it. */
const PANEL_GAP = 8

export interface BarPanel<K extends string> {
  key: K
  /** The dialog's accessible name. */
  label: string
  content: ReactNode
}

export interface PanelBarProps<K extends string> {
  /** The toolbar's accessible name. */
  label: string
  /** The bar's fixed width, which every panel shares. */
  width: number
  open: K | null
  onClose: () => void
  panels: readonly BarPanel<K>[]
  /** The bar's buttons. A button that opens a panel carries `data-panel-opener` with its key. */
  children: ReactNode
}

/**
 * A selection bar with its option panels stacked on it at the bar's own width. Every panel stays
 * mounted, shut ones inert and see-through, so moving between buttons cross-fades.
 */
export function PanelBar<K extends string>({ label, width, open, onClose, panels, children }: PanelBarProps<K>) {
  const frame = useRef<HTMLDivElement>(null)
  const bar = useRef<HTMLDivElement>(null)
  const sheets = useRef(new Map<K, HTMLDivElement>())
  const [side, setSide] = useState<"above" | "below">("above")
  const close = useRef(onClose)
  close.current = onClose

  const clearance = dockClearance(useDockedEdge())
  const keepOff = useRef(clearance)
  keepOff.current = clearance

  // Before paint, so a panel near the top of the pane opens below instead of flashing above first.
  // Again whenever the bar is moved or rescaled, which a pan or a zoom does without a press.
  useLayoutEffect(() => {
    if (open === null) {
      return
    }
    let frameId = 0
    let placed = ""
    // Checked again when the window, the panel or the bar's pop-in changes what fits, with the bar still.
    let stale = false
    const restale = () => {
      stale = true
    }
    const sized = new ResizeObserver(restale)
    const openSheet = sheets.current.get(open)
    if (openSheet) sized.observe(openSheet)
    window.addEventListener("resize", restale)
    bar.current?.addEventListener("animationend", restale)
    const choose = () => {
      frameId = requestAnimationFrame(choose)
      const node = bar.current
      const sheet = sheets.current.get(open)
      const host = frame.current?.parentElement
      if (!node || !sheet || !host) {
        return
      }
      const at = `${host.style.left} ${host.style.top} ${host.style.scale} ${keepOff.current.top} ${keepOff.current.bottom}`
      if (at === placed && !stale) {
        return
      }
      placed = at
      stale = false
      const pane = node.closest("[data-mm-pane]")?.getBoundingClientRect() ?? { top: 0, bottom: window.innerHeight }
      // The docked toolbar is off limits to the panel as it is to the bar.
      const room = { top: pane.top + keepOff.current.top, bottom: pane.bottom - keepOff.current.bottom }
      const rect = node.getBoundingClientRect()
      // The bar can be drawn shrunk at low zoom, and the panel with it.
      const scale = node.offsetHeight > 0 ? rect.height / node.offsetHeight : 1
      setSide(flyoutSide(rect, room, sheet.offsetHeight * scale, PANEL_GAP * scale))
    }
    choose()
    const node = bar.current
    return () => {
      cancelAnimationFrame(frameId)
      sized.disconnect()
      window.removeEventListener("resize", restale)
      node?.removeEventListener("animationend", restale)
    }
  }, [open])

  // A row that closes its own panel, such as a kind or a More item, would leave a keyboard user's
  // focus inside a panel that is now inert. Hand it back to the button that opened it.
  const shown = useRef<K | null>(null)
  useLayoutEffect(() => {
    const was = shown.current
    shown.current = open
    if (was !== null && was !== open && sheets.current.get(was)?.contains(document.activeElement)) {
      frame.current?.querySelector<HTMLElement>(`[data-panel-opener="${was}"]`)?.focus()
    }
  }, [open])

  useEffect(() => {
    if (open === null) {
      return
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!frame.current?.contains(event.target as Node)) {
        close.current()
      }
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      // A field being typed into, such as the label editor, keeps its own Escape.
      if (event.key !== "Escape" || isEditableTarget(event.target)) {
        return
      }
      // Taken before the canvas hears it, which would otherwise clear the selection the panel is about.
      event.stopPropagation()
      close.current()
    }
    // Capture, so a press that only dismisses the panel lands before the canvas starts a marquee with it.
    window.addEventListener("pointerdown", onPointerDown, true)
    window.addEventListener("keydown", onKeyDown, true)
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true)
      window.removeEventListener("keydown", onKeyDown, true)
    }
  }, [open])

  // One tab stop for the whole bar: the button last focused, or the first that can take the focus.
  useLayoutEffect(() => {
    const buttons = [...(bar.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
    const stop =
      buttons.find((button) => button.tabIndex === 0 && !button.disabled) ?? buttons.find((button) => !button.disabled)
    for (const button of buttons) {
      button.tabIndex = button === stop ? 0 : -1
    }
  })

  const above = side === "above"

  return (
    <div
      ref={frame}
      className="relative"
      style={{ width }}
      // The canvas treats a press on empty space as the start of a marquee, which would clear the
      // selection the bar is about.
      onPointerDown={(event) => event.stopPropagation()}
      // A press leaves the focus where it was, so the map keeps answering its keys after a mouse user
      // picks something here. Keyboard users still reach every control with Tab.
      onMouseDown={(event) => event.preventDefault()}
    >
      <div
        ref={bar}
        role="toolbar"
        aria-label={label}
        aria-orientation="horizontal"
        onKeyDown={rove}
        onFocus={(event) => {
          for (const button of event.currentTarget.querySelectorAll("button")) {
            button.tabIndex = button === (event.target as Element) ? 0 : -1
          }
        }}
        className={cn(
          "pointer-events-auto flex h-10 items-center gap-0.5 rounded-[13px] p-1",
          "bg-surface-float shadow-float animate-pop-in",
        )}
      >
        {children}
      </div>

      {panels.map((panel) => {
        const shown = panel.key === open
        return (
          <div
            key={panel.key}
            ref={(node) => {
              if (node) sheets.current.set(panel.key, node)
              else sheets.current.delete(panel.key)
            }}
            role="dialog"
            aria-label={panel.label}
            aria-hidden={!shown}
            inert={!shown}
            data-panel={panel.key}
            className={cn(
              "absolute left-0 rounded-2xl bg-surface-float p-2 shadow-float",
              shown ? "pointer-events-auto" : "pointer-events-none",
            )}
            style={{
              width,
              [above ? "bottom" : "top"]: `calc(100% + ${PANEL_GAP}px)`,
              opacity: shown ? 1 : 0,
              transform: shown ? "none" : `translateY(calc(var(--travel-pop) * ${above ? 1 : -1})) scale(0.98)`,
              transformOrigin: above ? "50% 100%" : "50% 0%",
              transition:
                "opacity var(--duration-normal) ease, transform var(--duration-panel) var(--ease-settle)",
            }}
          >
            {panel.content}
          </div>
        )
      })}
    </div>
  )
}

/** Arrow keys walk the bar's enabled buttons, Home and End jump to either end. */
function rove(event: KeyboardEvent<HTMLDivElement>) {
  const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")]
  const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
  const last = buttons.length - 1
  const next =
    event.key === "ArrowRight"
      ? at < last ? at + 1 : 0
      : event.key === "ArrowLeft"
        ? at > 0 ? at - 1 : last
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? last
            : null
  if (next === null || last < 0) {
    return
  }
  event.preventDefault()
  buttons[next].focus()
}
