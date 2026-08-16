import { create } from "zustand"

interface PaletteState {
  open: boolean
  setOpen: (open: boolean) => void
  toggle: () => void
}

/**
 * The global search overlay's open state.
 *
 * A store rather than shell state because three different things open it: the
 * topbar button, the global.search keybind, and eventually rows inside other
 * overlays. None of them are children of the component that renders it.
 */
export const usePaletteStore = create<PaletteState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
}))
