import { create } from "zustand"

/** What an export covers. Null when the caller only offers import. */
export interface NoteTransferScope {
  /** How the scope reads in the dialog, e.g. the note's own title. */
  label: string
  noteIds: string[]
}

export interface NoteTransferTarget {
  /** Directions on offer. A single one hides the toggle and fixes the dialog to that side. */
  direction: "import" | "export" | "both"
  scope: NoteTransferScope | null
}

interface NoteTransferState {
  target: NoteTransferTarget | null
  open: (target: NoteTransferTarget) => void
  close: () => void
}

/**
 * Which note transfer dialog is open, if any. A store rather than local state because the entry
 * points are far apart in the tree, the sidebar header and a note's breadcrumb and row menu, and a
 * menu item cannot own a dialog that has to outlive the menu closing.
 */
export const useNoteTransfer = create<NoteTransferState>((set) => ({
  target: null,
  open: (target) => set({ target }),
  close: () => set({ target: null }),
}))
