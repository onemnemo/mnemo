import { create } from "zustand"

/** What an export covers. Null when the caller only offers import. */
export interface MindmapTransferScope {
  /** How the scope reads in the dialog, e.g. the map's own title. */
  label: string
  mapIds: string[]
}

export interface MindmapTransferTarget {
  /** Directions on offer. A single one hides the toggle and fixes the dialog to that side. */
  direction: "import" | "export" | "both"
  scope: MindmapTransferScope | null
}

interface MindmapTransferState {
  target: MindmapTransferTarget | null
  open: (target: MindmapTransferTarget) => void
  close: () => void
}

/**
 * Which mindmap transfer dialog is open, if any. A store rather than local state because the entry
 * points are far apart in the tree, the library header and a card's overflow menu, and a menu item
 * cannot own a dialog that has to outlive the menu closing.
 */
export const useMindmapTransfer = create<MindmapTransferState>((set) => ({
  target: null,
  open: (target) => set({ target }),
  close: () => set({ target: null }),
}))
