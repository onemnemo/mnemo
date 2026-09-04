import { create } from "zustand"

interface ShellState {
  sidebarCollapsed: boolean
  setSidebarCollapsed: (collapsed: boolean) => void
  toggleSidebar: () => void
}

const SIDEBAR_KEY = "mnemo.shell.sidebarCollapsed"

/**
 * Closed until the reader opens it, and afterwards whatever they left it as.
 *
 * The rail carries every destination, so a fresh profile loses nothing by
 * starting narrow, and the canvas is what the app is for. Someone who opens
 * the sidebar has made a decision about their screen, and re-taking it on
 * every launch is a worse default than either fixed one. Read the way the
 * assistant dock reads its width, from local storage, so the choice survives
 * a restart without a settings key nobody would look for.
 */
function readCollapsed(): boolean {
  try {
    const raw = localStorage.getItem(SIDEBAR_KEY)
    return raw !== "false"
  } catch {
    return true
  }
}

function writeCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_KEY, String(collapsed))
  } catch {
    // Non-fatal: the choice still applies for this session.
  }
}

/**
 * Frame state that is not the frame's alone.
 *
 * Collapse started as local state in AppShell and moved here the moment the
 * palette needed to toggle it: the palette is not a child of the shell, and
 * threading a setter through a portal to reach it would be worse than a store.
 */
export const useShellStore = create<ShellState>((set, get) => ({
  sidebarCollapsed: readCollapsed(),
  setSidebarCollapsed: (sidebarCollapsed) => {
    set({ sidebarCollapsed })
    writeCollapsed(sidebarCollapsed)
  },
  toggleSidebar: () => get().setSidebarCollapsed(!get().sidebarCollapsed),
}))
