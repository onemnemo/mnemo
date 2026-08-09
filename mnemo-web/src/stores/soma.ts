import { create } from "zustand"

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
}

export const useSomaStore = create<SomaState>((set) => ({
  dockOpen: false,
  toggleDock: () => set((s) => ({ dockOpen: !s.dockOpen })),
  setDockOpen: (dockOpen) => set({ dockOpen }),
}))

export function useSomaDockOpen(): boolean {
  return useSomaStore((s) => s.dockOpen)
}
