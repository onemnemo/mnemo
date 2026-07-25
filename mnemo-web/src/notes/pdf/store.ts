import { create } from "zustand"

/** The note a PDF export dialog is bound to. */
export interface NotePdfTarget {
  noteId: string
  /** How the note reads in the dialog header, e.g. its title. */
  title: string
}

interface NotePdfState {
  target: NotePdfTarget | null
  open: (target: NotePdfTarget) => void
  close: () => void
}

/**
 * Which note's PDF export dialog is open, if any. A store rather than local state for the same
 * reason as {@link useNoteTransfer}: the entry points (breadcrumb, tree row menu) are far apart in
 * the tree and a menu item cannot own a dialog that outlives the menu closing.
 */
export const useNotePdf = create<NotePdfState>((set) => ({
  target: null,
  open: (target) => set({ target }),
  close: () => set({ target: null }),
}))
