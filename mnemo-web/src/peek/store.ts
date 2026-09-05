import { create } from "zustand"

import type { CardViewDto } from "@/api/types"
import { getAiEnabled } from "@/settings/aiEnabled"
import { useSomaStore } from "@/stores/soma"

/**
 * The side peek: a second, read-only workspace beside or over the canvas.
 *
 * One item at a time. A back stack would make this a small window manager, and the
 * moment it is one it owes reordering and reopen-closed; the entry points already
 * name the thing to look at, so there is nothing for history to recover.
 *
 * Shape (width, placement, side, pinned, collapsed, background) is persisted the way
 * the assistant dock persists its width: someone splitting their screen a certain way
 * has made a decision, and re-taking it on every launch is a worse default than any we
 * could pick. The item is never persisted; a panel that reopens onto whatever was last
 * glanced at is furniture holding a stale answer.
 */

/** Overlay covers the canvas and leaves a strip of it; docked takes a column of its own. */
export type PeekPlacement = "overlay" | "docked"
export type PeekSide = "right" | "left"

/**
 * What the peek is showing.
 *
 * A card carries its own view rather than an id: there is no endpoint that serves one
 * card, the browse table that opens it already holds the row, and the item is never
 * persisted, so nothing here has to survive a restart.
 *
 * No map. The canvas binds window-level key and blur listeners and captures wheel,
 * pointer and keydown across its pane, so a second one beside the first fights the
 * first for every gesture, and the library thumbnail that stood in for it showed
 * nothing the card had not. A map joins when the peek can host a real read-only map.
 */
export type PeekItem =
  | { readonly kind: "note"; readonly id: string }
  | {
      readonly kind: "card"
      readonly id: string
      readonly deckId: string
      readonly deckName: string
      readonly view: CardViewDto
    }
  | { readonly kind: "soma" }

export const PEEK_MIN_WIDTH = 400
export const PEEK_MAX_WIDTH = 760
export const PEEK_DEFAULT_WIDTH = 520
/** Collapsed, the peek keeps its item and shows this much of itself. */
export const PEEK_RAIL_WIDTH = 30
/** The canvas an overlay leaves showing, all of it or none. */
export const PEEK_CANVAS_STRIP = 96

export const PEEK_MIN_ALPHA = 40
export const PEEK_MAX_ALPHA = 100
export const PEEK_ALPHA_STEP = 10

const KEYS = {
  width: "mnemo.peek.width",
  placement: "mnemo.peek.placement",
  side: "mnemo.peek.side",
  pinned: "mnemo.peek.pinned",
  collapsed: "mnemo.peek.collapsed",
  alpha: "mnemo.peek.alpha",
} as const

/** Keeps a dragged or restored width inside the range the panel still reads well at. */
export function clampPeekWidth(px: number): number {
  return Math.min(PEEK_MAX_WIDTH, Math.max(PEEK_MIN_WIDTH, Math.round(px)))
}

/** Background opacity as a whole percentage, on the steps the menu offers. */
export function clampPeekAlpha(percent: number): number {
  const stepped = Math.round(percent / PEEK_ALPHA_STEP) * PEEK_ALPHA_STEP
  return Math.min(PEEK_MAX_ALPHA, Math.max(PEEK_MIN_ALPHA, stepped))
}

/** The background opacity choices, opaque first, as the menu lists them. */
export function peekAlphaOptions(): readonly number[] {
  const options: number[] = []
  for (let value = PEEK_MAX_ALPHA; value >= PEEK_MIN_ALPHA; value -= PEEK_ALPHA_STEP) options.push(value)
  return options
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Non-fatal: the choice still applies for this session.
  }
}

function readNumber(key: string, fallback: number, clamp: (value: number) => number): number {
  const raw = read(key)
  if (raw === null) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? clamp(parsed) : fallback
}

function readFlag(key: string): boolean {
  return read(key) === "true"
}

function readPlacement(): PeekPlacement {
  return read(KEYS.placement) === "docked" ? "docked" : "overlay"
}

function readSide(): PeekSide {
  return read(KEYS.side) === "left" ? "left" : "right"
}

interface PeekState {
  /** What the peek is showing, or null when it is closed. Never persisted. */
  item: PeekItem | null
  /**
   * Bumped on every open, item switch and explicit refresh. Renderers put it in a
   * React key, so a refresh is a clean remount rather than a document swapped in
   * under whatever the reader was looking at.
   */
  nonce: number

  width: number
  placement: PeekPlacement
  side: PeekSide
  pinned: boolean
  collapsed: boolean
  /** Panel background opacity, 40 to 100 percent. Overlay only. */
  alpha: number

  openPeek: (item: PeekItem) => void
  closePeek: () => void
  refreshPeek: () => void

  setWidth: (px: number) => void
  setPlacement: (placement: PeekPlacement) => void
  setSide: (side: PeekSide) => void
  togglePinned: () => void
  toggleCollapsed: () => void
  setAlpha: (percent: number) => void
}

export const usePeekStore = create<PeekState>((set, get) => ({
  item: null,
  nonce: 0,

  width: readNumber(KEYS.width, PEEK_DEFAULT_WIDTH, clampPeekWidth),
  placement: readPlacement(),
  side: readSide(),
  pinned: readFlag(KEYS.pinned),
  collapsed: readFlag(KEYS.collapsed),
  alpha: readNumber(KEYS.alpha, PEEK_MAX_ALPHA, clampPeekAlpha),

  openPeek: (item) => {
    // The assistant toggle hides Soma everywhere rather than disabling it, so with it
    // off there is no Soma surface for the peek to host either.
    if (item.kind === "soma") {
      if (!getAiEnabled()) return
      useSomaStore.getState().setDockOpen(false)
    }
    set((s) => ({ item, nonce: s.nonce + 1, collapsed: false }))
  },

  closePeek: () => set({ item: null }),

  refreshPeek: () => {
    if (!get().item) return
    set((s) => ({ nonce: s.nonce + 1 }))
  },

  setWidth: (px) => {
    const width = clampPeekWidth(px)
    set({ width })
    write(KEYS.width, String(width))
  },

  setPlacement: (placement) => {
    // Docking a collapsed peek would take a column and show a rail in it.
    set({ placement, collapsed: false })
    write(KEYS.placement, placement)
    write(KEYS.collapsed, "false")
  },

  setSide: (side) => {
    set({ side })
    write(KEYS.side, side)
  },

  togglePinned: () => {
    const pinned = !get().pinned
    set({ pinned })
    write(KEYS.pinned, String(pinned))
  },

  toggleCollapsed: () => {
    const collapsed = !get().collapsed
    set({ collapsed })
    write(KEYS.collapsed, String(collapsed))
  },

  setAlpha: (percent) => {
    const alpha = clampPeekAlpha(percent)
    set({ alpha })
    write(KEYS.alpha, String(alpha))
  },
}))

/**
 * Escape closes a glance, never a workspace.
 *
 * Docked or pinned, the peek is furniture put there on purpose, and furniture that
 * vanishes when a menu is dismissed is furniture nobody trusts. Those close by their
 * own button.
 */
export function escapeClosesPeek(): boolean {
  const { placement, pinned } = usePeekStore.getState()
  return placement === "overlay" && !pinned
}

/** Opens a note in the peek. The entry the tree row and the tab menu both call. */
export function openNoteInPeek(noteId: string): void {
  usePeekStore.getState().openPeek({ kind: "note", id: noteId })
}

/** Drops the current item when it is the one that just went away. */
export function closePeekForItem(kind: PeekItem["kind"], id: string): void {
  const item = usePeekStore.getState().item
  if (!item || item.kind !== kind || !("id" in item) || item.id !== id) return
  usePeekStore.getState().closePeek()
}

// Soma is one conversation with one composer, so it is either in the dock or in the
// peek and never in both. The rule lives here rather than in the dock's store because
// the peek already knows about the dock, and putting it there would have the two
// importing each other.
useSomaStore.subscribe((state, previous) => {
  if (!state.dockOpen || previous.dockOpen) return
  if (usePeekStore.getState().item?.kind === "soma") usePeekStore.getState().closePeek()
})
