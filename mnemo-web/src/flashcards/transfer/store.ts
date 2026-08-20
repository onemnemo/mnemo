import { create } from "zustand"

/** What an export covers. Null when the caller only offers import. */
export interface TransferScope {
  /** How the scope reads in the dialog, e.g. "All decks" or the deck's own name. */
  label: string
  deckIds: string[]
  /**
   * True when the scope is the whole collection rather than a chosen part of it. The two go out
   * as the same list of ids, so the entry point that opened the dialog is the only thing that
   * knows the difference, and the difference decides whether the file is a backup or an export.
   */
  wholeCollection?: boolean
}

export interface TransferTarget {
  /** Directions on offer. A single one hides the toggle and fixes the dialog to that side. */
  direction: "import" | "export" | "both"
  scope: TransferScope | null
}

interface TransferState {
  target: TransferTarget | null
  open: (target: TransferTarget) => void
  close: () => void
}

/**
 * Which transfer dialog is open, if any. A store rather than local state because the two entry
 * points are far apart in the tree - the library header and a deck page's row menu - and a menu
 * item cannot own a dialog that has to outlive the menu closing.
 */
export const useTransfer = create<TransferState>((set) => ({
  target: null,
  open: (target) => set({ target }),
  close: () => set({ target: null }),
}))
