import { create } from "zustand"

interface ShellState {
  sidebarCollapsed: boolean
  setSidebarCollapsed: (collapsed: boolean) => void
  toggleSidebar: () => void
}

/**
 * Frame state that is not the frame's alone.
 *
 * Collapse started as local state in AppShell and moved here the moment the
 * palette needed to toggle it: the palette is not a child of the shell, and
 * threading a setter through a portal to reach it would be worse than a store.
 */
export const useShellStore = create<ShellState>((set) => ({
  sidebarCollapsed: false,
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
}))
