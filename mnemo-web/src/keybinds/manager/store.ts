import { create } from "zustand"

interface KeybindManagerState {
  isOpen: boolean
  open: () => void
  close: () => void
}

/**
 * Whether the keybind manager overlay is showing. It is a global surface (Settings
 * opens it today, a shortcut could tomorrow), so the flag lives outside the page.
 */
export const useKeybindManagerStore = create<KeybindManagerState>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
}))
