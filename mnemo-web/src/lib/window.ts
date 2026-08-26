// The web half of the chromeless titlebar. Mnemo.Host/Chrome/WindowChrome.cs is
// the other half, and the message names are the contract between them.
//
// Outside the Photino window (the dev server in a browser tab, tests) there is no
// bridge, so every call here is a no-op. The chrome still renders: it is part of
// the layout, and a titlebar that vanishes in dev is a titlebar nobody looks at.

interface PhotinoBridge {
  sendMessage?: (message: string) => void
  receiveMessage?: (callback: (message: string) => void) => void
}

export type WindowEdge =
  | "top"
  | "bottom"
  | "left"
  | "right"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right"

function bridge(): PhotinoBridge | undefined {
  return (window as { external?: PhotinoBridge }).external
}

/** True inside the Photino window, false in a plain browser. */
export const isNativeWindow: boolean = typeof bridge()?.sendMessage === "function"

function send(message: Record<string, unknown>): void {
  bridge()?.sendMessage?.(JSON.stringify(message))
}

export function beginWindowDrag(): void {
  send({ type: "chrome.drag" })
}

export function beginWindowResize(edge: WindowEdge): void {
  send({ type: "chrome.resize", edge })
}

export function minimizeWindow(): void {
  send({ type: "chrome.minimize" })
}

export function toggleMaximizeWindow(): void {
  send({ type: "chrome.toggle-maximize" })
}

export function closeWindow(): void {
  send({ type: "chrome.close" })
}

/** A rectangle in CSS pixels from the top left of the webview. */
export interface DragRect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Tells the host where the titlebar's drag surfaces and their interactive
 * exclusions are.
 *
 * Only Linux consumes it: GTK and Wayland will not start a window move from a
 * message, so the draggable area has to be claimed as native hit-test regions
 * ahead of the gesture rather than in response to it. No-drag wins over drag,
 * which is what lets the shell declare whole bars and carve the controls back
 * out: the same shape `app-region` already gives the other platforms.
 */
export function reportDragRegions(drag: DragRect[], noDrag: DragRect[]): void {
  send({ type: "chrome.drag-regions", drag, noDrag })
}

const maximizeListeners = new Set<(maximized: boolean) => void>()
let maximized = false
let receiving = false

function startReceiving(): void {
  if (receiving) return
  receiving = true

  // Photino allows one callback, so subscribers fan out from here rather than
  // each registering their own and quietly replacing the last.
  bridge()?.receiveMessage?.((raw) => {
    let parsed: { type?: string; maximized?: boolean }
    try {
      parsed = JSON.parse(raw)
    } catch {
      return
    }
    if (parsed.type !== "chrome.state") return

    maximized = parsed.maximized === true
    for (const listener of maximizeListeners) listener(maximized)
  })

  send({ type: "chrome.ready" })
}

/** Subscribes to maximize/restore, including changes the OS makes (snap, Win+Up). */
export function onMaximizeChange(listener: (maximized: boolean) => void): () => void {
  startReceiving()
  maximizeListeners.add(listener)
  listener(maximized)
  return () => {
    maximizeListeners.delete(listener)
  }
}

const DOUBLE_CLICK_MS = 400
const DOUBLE_CLICK_SLOP_PX = 5
let lastPress = { time: 0, x: 0, y: 0 }

/**
 * Pointer-down handler for a draggable part of the titlebar.
 *
 * Double click is detected here rather than with a dblclick handler because there
 * will not be one: the OS takes the pointer the moment the drag starts, so the
 * webview never sees the release, let alone the second click.
 */
export function onTitlebarPointerDown(event: React.PointerEvent): void {
  // Primary button only, and never from a control that happens to sit in the bar.
  if (event.button !== 0) return
  if ((event.target as HTMLElement).closest("button, a, input, [role='button']")) return

  const now = Date.now()
  const isDoubleClick =
    now - lastPress.time < DOUBLE_CLICK_MS &&
    Math.abs(event.clientX - lastPress.x) < DOUBLE_CLICK_SLOP_PX &&
    Math.abs(event.clientY - lastPress.y) < DOUBLE_CLICK_SLOP_PX

  lastPress = { time: now, x: event.clientX, y: event.clientY }

  if (isDoubleClick) {
    lastPress.time = 0 // A triple click should not toggle twice.
    toggleMaximizeWindow()
    return
  }

  beginWindowDrag()
}
