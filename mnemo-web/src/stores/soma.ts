import { create } from "zustand"

const WIDTH_KEY = "mnemo.soma.dock-width"

export const DOCK_DEFAULT_WIDTH = 400
export const DOCK_MIN_WIDTH = 300
export const DOCK_MAX_WIDTH = 720

/** Keeps a dragged or restored width inside the range the dock still reads well at. */
export function clampDockWidth(px: number): number {
  return Math.min(DOCK_MAX_WIDTH, Math.max(DOCK_MIN_WIDTH, Math.round(px)))
}

function readStoredWidth(): number {
  try {
    const raw = localStorage.getItem(WIDTH_KEY)
    if (!raw) return DOCK_DEFAULT_WIDTH
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? clampDockWidth(parsed) : DOCK_DEFAULT_WIDTH
  } catch {
    return DOCK_DEFAULT_WIDTH
  }
}

interface SomaState {
  /**
   * The dock is frame furniture rather than a module: it sits beside whatever the
   * canvas is showing, so it survives navigation instead of dying with the page
   * that opened it. That is the whole point of it, and the reason this state lives
   * here and not in a route.
   */
  dockOpen: boolean
  toggleDock: () => void
  setDockOpen: (open: boolean) => void

  /**
   * How wide the dock is, in pixels. Persisted because the dock pushes the canvas
   * rather than floating over it: the width someone picked is a decision about how
   * to split their screen, and re-taking it on every launch is a worse default than
   * anything we could choose for them.
   */
  dockWidth: number
  setDockWidth: (px: number) => void
}

export const useSomaStore = create<SomaState>((set) => ({
  dockOpen: false,
  toggleDock: () => set((s) => ({ dockOpen: !s.dockOpen })),
  setDockOpen: (dockOpen) => set({ dockOpen }),

  dockWidth: readStoredWidth(),
  setDockWidth: (px) => {
    const dockWidth = clampDockWidth(px)
    set({ dockWidth })
    try {
      localStorage.setItem(WIDTH_KEY, String(dockWidth))
    } catch {
      // Non-fatal: the width still applies for this session.
    }
  },
}))

export function useSomaDockOpen(): boolean {
  return useSomaStore((s) => s.dockOpen)
}
